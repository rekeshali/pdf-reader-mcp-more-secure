import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetConfigCache, CONFIG_PATH_FOR_TESTS, loadConfig } from '../../src/utils/config.js';

describe('config loader', () => {
  let readSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetConfigCache();
    readSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    readSpy.mockRestore();
    _resetConfigCache();
  });

  const DEFAULTS = {
    path: { allow: [], deny: [] },
    url: { allow: [], deny: [] },
    maxFileSizeMB: 300,
  };

  it('returns defaults when the file does not exist', () => {
    readSpy.mockImplementation(() => {
      const err = new Error('no such file') as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    });
    expect(loadConfig()).toEqual(DEFAULTS);
  });

  it('returns defaults when the file is malformed JSON', () => {
    readSpy.mockImplementation(() => '{not json');
    expect(loadConfig()).toEqual(DEFAULTS);
  });

  it('parses a well-formed config', () => {
    readSpy.mockImplementation(() =>
      JSON.stringify({
        path: { allow: ['~/Documents/**'], deny: ['~/.ssh/**'] },
        url: { allow: ['*.internal.example.com'], deny: ['evil.example.com'] },
        maxFileSizeMB: 500,
      })
    );
    expect(loadConfig()).toEqual({
      path: { allow: ['~/Documents/**'], deny: ['~/.ssh/**'] },
      url: { allow: ['*.internal.example.com'], deny: ['evil.example.com'] },
      maxFileSizeMB: 500,
    });
  });

  it('coerces missing sections to empty arrays', () => {
    readSpy.mockImplementation(() => JSON.stringify({ path: { allow: ['/tmp'] } }));
    expect(loadConfig()).toEqual({
      path: { allow: ['/tmp'], deny: [] },
      url: { allow: [], deny: [] },
      maxFileSizeMB: 300,
    });
  });

  it('ignores non-array values in allow/deny fields', () => {
    readSpy.mockImplementation(() =>
      JSON.stringify({
        path: { allow: 'not-an-array', deny: [123, 'valid'] },
      })
    );
    expect(loadConfig()).toEqual(DEFAULTS); // allow wasn't array, deny had non-string
  });

  it('caches after first load', () => {
    readSpy.mockImplementation(() => JSON.stringify({ path: { allow: ['a'] } }));
    loadConfig();
    loadConfig();
    loadConfig();
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves to ~/.claude/plugin-settings/pdf-reader.json', () => {
    expect(CONFIG_PATH_FOR_TESTS).toMatch(/\.claude\/plugin-settings\/pdf-reader\.json$/);
  });

  describe('maxFileSizeMB', () => {
    it('defaults to 300 when unset', () => {
      readSpy.mockImplementation(() => JSON.stringify({}));
      expect(loadConfig().maxFileSizeMB).toBe(300);
    });

    it('accepts a positive number override', () => {
      readSpy.mockImplementation(() => JSON.stringify({ maxFileSizeMB: 500 }));
      expect(loadConfig().maxFileSizeMB).toBe(500);
    });

    it('falls back to 300 when value is not a number', () => {
      readSpy.mockImplementation(() => JSON.stringify({ maxFileSizeMB: 'big' }));
      expect(loadConfig().maxFileSizeMB).toBe(300);
    });

    it('falls back to 300 when value is zero or negative', () => {
      readSpy.mockImplementation(() => JSON.stringify({ maxFileSizeMB: 0 }));
      expect(loadConfig().maxFileSizeMB).toBe(300);
      _resetConfigCache();
      readSpy.mockImplementation(() => JSON.stringify({ maxFileSizeMB: -50 }));
      expect(loadConfig().maxFileSizeMB).toBe(300);
    });
  });
});
