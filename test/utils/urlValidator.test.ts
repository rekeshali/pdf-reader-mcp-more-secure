import * as dns from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetConfigCache, loadConfig } from '../../src/utils/config.js';
import { PdfError } from '../../src/utils/errors.js';
import { validateUrl } from '../../src/utils/urlValidator.js';

// loadConfig reads from fs.readFileSync. We stub via spy in each test's setup.

describe('validateUrl', () => {
  let lookupSpy: ReturnType<typeof vi.spyOn>;
  let readSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    _resetConfigCache();
    // Stub config to return empty by default (no allow, no deny).
    const fs = await import('node:fs');
    readSpy = vi.spyOn(fs, 'readFileSync');
    readSpy.mockImplementation(() => {
      const err = new Error('no such file') as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    });
    // Stub DNS to return a public IP by default.
    lookupSpy = vi.spyOn(dns, 'lookup');
    lookupSpy.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    lookupSpy.mockRestore();
    readSpy.mockRestore();
    _resetConfigCache();
  });

  describe('scheme', () => {
    it('accepts https://', async () => {
      await expect(validateUrl('https://example.com/doc.pdf', 'desc')).resolves.toBeInstanceOf(URL);
    });

    it('rejects http://', async () => {
      await expect(validateUrl('http://example.com', 'desc')).rejects.toThrow(
        "only https:// URLs are allowed (got 'http:')"
      );
    });

    it('rejects file://', async () => {
      await expect(validateUrl('file:///etc/passwd', 'desc')).rejects.toThrow(
        "only https:// URLs are allowed (got 'file:')"
      );
    });

    it('rejects data:', async () => {
      await expect(validateUrl('data:application/pdf;base64,AAA', 'desc')).rejects.toThrow(
        "only https:// URLs are allowed (got 'data:')"
      );
    });

    it('rejects malformed URLs', async () => {
      await expect(validateUrl('not a url', 'desc')).rejects.toThrow('invalid URL');
    });
  });

  describe('SSRF floor (always on)', () => {
    it('blocks IPv4 loopback via DNS-resolved IP', async () => {
      lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(validateUrl('https://localhost/doc.pdf', 'desc')).rejects.toThrow(
        /resolves to 127\.0\.0\.1.*SSRF floor/
      );
    });

    it('blocks AWS/GCP metadata endpoint (169.254.169.254)', async () => {
      lookupSpy.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(validateUrl('https://metadata.local/creds', 'desc')).rejects.toThrow(/169\.254\.169\.254/);
    });

    it('blocks RFC 1918 10/8', async () => {
      lookupSpy.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
      await expect(validateUrl('https://intranet.corp/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('blocks RFC 1918 172.16/12', async () => {
      lookupSpy.mockResolvedValue([{ address: '172.20.1.1', family: 4 }]);
      await expect(validateUrl('https://a.corp/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('blocks RFC 1918 192.168/16', async () => {
      lookupSpy.mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
      await expect(validateUrl('https://router.home/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('blocks IPv6 loopback', async () => {
      lookupSpy.mockResolvedValue([{ address: '::1', family: 6 }]);
      await expect(validateUrl('https://ipv6-local/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('blocks IPv6 link-local (fe80::/10)', async () => {
      lookupSpy.mockResolvedValue([{ address: 'fe80::1', family: 6 }]);
      await expect(validateUrl('https://ipv6-link/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('blocks IPv6 unique local (fc00::/7)', async () => {
      lookupSpy.mockResolvedValue([{ address: 'fd12::1', family: 6 }]);
      await expect(validateUrl('https://ipv6-ula/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('blocks if ANY resolved IP is in the floor (multi-record DNS)', async () => {
      lookupSpy.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);
      await expect(validateUrl('https://mixed.example/doc', 'desc')).rejects.toThrow(/SSRF floor/);
    });

    it('skips DNS when hostname is a public IP literal', async () => {
      await expect(validateUrl('https://93.184.216.34/doc', 'desc')).resolves.toBeInstanceOf(URL);
      expect(lookupSpy).not.toHaveBeenCalled();
    });

    it('blocks an IP literal that is in the floor', async () => {
      await expect(validateUrl('https://127.0.0.1/doc', 'desc')).rejects.toThrow(/SSRF floor/);
      expect(lookupSpy).not.toHaveBeenCalled();
    });
  });

  describe('user allow/deny', () => {
    it('rejects hosts matching the user deny list', async () => {
      readSpy.mockImplementation(() => JSON.stringify({ url: { deny: ['evil.example.com', '*.malware.net'] } }));
      await expect(validateUrl('https://evil.example.com/p', 'desc')).rejects.toThrow(/deny list/);
      await expect(validateUrl('https://x.malware.net/p', 'desc')).rejects.toThrow(/deny list/);
    });

    it('allows only hosts in the allow list when it is non-empty', async () => {
      readSpy.mockImplementation(() => JSON.stringify({ url: { allow: ['*.internal.example.com'] } }));
      await expect(validateUrl('https://docs.internal.example.com/p', 'desc')).resolves.toBeInstanceOf(URL);
      await expect(validateUrl('https://example.com/p', 'desc')).rejects.toThrow(/allow list/);
    });

    it('deny wins when both match', async () => {
      readSpy.mockImplementation(() =>
        JSON.stringify({
          url: { allow: ['*.example.com'], deny: ['evil.example.com'] },
        })
      );
      await expect(validateUrl('https://evil.example.com/p', 'desc')).rejects.toThrow(/deny list/);
      await expect(validateUrl('https://ok.example.com/p', 'desc')).resolves.toBeInstanceOf(URL);
    });

    it('SSRF floor still blocks even if user allow-list matches', async () => {
      readSpy.mockImplementation(() => JSON.stringify({ url: { allow: ['*'] } }));
      lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(validateUrl('https://sneaky.example.com/p', 'desc')).rejects.toThrow(/SSRF floor/);
    });
  });

  describe('glob matching', () => {
    it('matches single-label wildcard', async () => {
      readSpy.mockImplementation(() => JSON.stringify({ url: { allow: ['foo.example.com'] } }));
      await expect(validateUrl('https://foo.example.com/p', 'desc')).resolves.toBeInstanceOf(URL);
      await expect(validateUrl('https://bar.example.com/p', 'desc')).rejects.toThrow();
    });

    it('* matches any chars including dots (wildcard cert style)', async () => {
      readSpy.mockImplementation(() => JSON.stringify({ url: { allow: ['*.internal.example.com'] } }));
      await expect(validateUrl('https://a.b.internal.example.com/p', 'desc')).resolves.toBeInstanceOf(URL);
    });

    it('is case-insensitive', async () => {
      readSpy.mockImplementation(() => JSON.stringify({ url: { deny: ['EVIL.example.com'] } }));
      await expect(validateUrl('https://evil.EXAMPLE.com/p', 'desc')).rejects.toThrow(/deny/);
    });
  });
});
