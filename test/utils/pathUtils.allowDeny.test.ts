import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetConfigCache } from '../../src/utils/config.js';
import { PdfError } from '../../src/utils/errors.js';
import { resolvePath } from '../../src/utils/pathUtils.js';

describe('resolvePath — allow/deny', () => {
  let readSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetConfigCache();
    readSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    readSpy.mockRestore();
    _resetConfigCache();
  });

  it('returns resolved path when no config is set', () => {
    readSpy.mockImplementation(() => {
      const err = new Error('nope') as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    });
    expect(resolvePath('/tmp/x.pdf')).toBe(path.normalize('/tmp/x.pdf'));
  });

  it('rejects paths matching the deny list', () => {
    readSpy.mockImplementation(() => JSON.stringify({ path: { deny: [`${os.homedir()}/.ssh/**`] } }));
    expect(() => resolvePath(`${os.homedir()}/.ssh/id_rsa`)).toThrow(PdfError);
    expect(() => resolvePath(`${os.homedir()}/.ssh/id_rsa`)).toThrow(/deny list/);
  });

  it('expands ~ in deny patterns', () => {
    readSpy.mockImplementation(() => JSON.stringify({ path: { deny: ['~/.ssh/**'] } }));
    expect(() => resolvePath(`${os.homedir()}/.ssh/id_rsa`)).toThrow(/deny list/);
  });

  it('enforces allow list when non-empty', () => {
    readSpy.mockImplementation(() => JSON.stringify({ path: { allow: [`${os.homedir()}/Documents/**`] } }));
    expect(resolvePath(`${os.homedir()}/Documents/x.pdf`)).toBe(path.normalize(`${os.homedir()}/Documents/x.pdf`));
    expect(() => resolvePath('/tmp/x.pdf')).toThrow(/allow list/);
  });

  it('deny wins when both match', () => {
    readSpy.mockImplementation(() =>
      JSON.stringify({
        path: { allow: ['/tmp/**'], deny: ['/tmp/secrets/**'] },
      })
    );
    expect(resolvePath('/tmp/ok.pdf')).toBe(path.normalize('/tmp/ok.pdf'));
    expect(() => resolvePath('/tmp/secrets/creds.pdf')).toThrow(/deny list/);
  });

  it('allows all paths when both lists are empty', () => {
    readSpy.mockImplementation(() => JSON.stringify({ path: { allow: [], deny: [] } }));
    expect(resolvePath('/any/path.pdf')).toBe(path.normalize('/any/path.pdf'));
  });
});
