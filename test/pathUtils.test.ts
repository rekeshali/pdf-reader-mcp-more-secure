import path from 'node:path';
import { describe, expect, it } from 'vitest'; // Removed beforeEach, vi
import { ErrorCode, PdfError } from '../src/utils/errors.js';
import { PROJECT_ROOT, resolvePath } from '../src/utils/pathUtils.js'; // Add .js extension

// Mock PROJECT_ROOT for consistent testing if needed, or use the actual one
// For this test, using the actual PROJECT_ROOT derived from process.cwd() is likely fine,
// but be aware it depends on where the test runner executes.
// If consistency across environments is critical, mocking might be better.
// vi.mock('../src/utils/pathUtils', async (importOriginal) => {
//   const original = await importOriginal();
//   return {
//     ...original,
//     PROJECT_ROOT: '/mock/project/root', // Example mock path
//   };
// });

describe('resolvePath Utility', () => {
  it('should resolve a valid relative path correctly', () => {
    const userPath = 'some/file.txt';
    const expectedPath = path.resolve(PROJECT_ROOT, userPath);
    expect(resolvePath(userPath)).toBe(expectedPath);
  });

  it('should resolve paths with "." correctly', () => {
    const userPath = './some/./other/file.txt';
    const expectedPath = path.resolve(PROJECT_ROOT, 'some/other/file.txt');
    expect(resolvePath(userPath)).toBe(expectedPath);
  });

  it('should resolve paths with ".." correctly within the project root', () => {
    const userPath = 'some/folder/../other/file.txt';
    const expectedPath = path.resolve(PROJECT_ROOT, 'some/other/file.txt');
    expect(resolvePath(userPath)).toBe(expectedPath);
  });

  it('should allow paths within home directory', () => {
    // Paths that escape PROJECT_ROOT but stay within home directory should be allowed
    const userPath = '../outside/secret.txt';
    // This should succeed as it's still within the home directory
    const result = resolvePath(userPath);
    expect(result).toBe(path.resolve(PROJECT_ROOT, userPath));
  });

  it('should block path traversal with multiple ".." components', () => {
    // Construct a path that uses '..' many times to escape PROJECT_ROOT
    const levelsUp = PROJECT_ROOT.split(path.sep).filter(Boolean).length + 2; // Go up more levels than the root has
    const userPath = path.join(...(Array(levelsUp).fill('..') as string[]), 'secret.txt'); // Cast array to string[]
    expect(() => resolvePath(userPath)).toThrow(PdfError);
    expect(() => resolvePath(userPath)).toThrow('Access denied: Path resolves outside allowed directories.');
  });

  it('should accept absolute paths within allowed roots and return them normalized', () => {
    // Test with path inside PROJECT_ROOT
    const userPath = path.resolve(PROJECT_ROOT, 'absolute/file.txt');
    expect(resolvePath(userPath)).toBe(path.normalize(userPath));
  });

  it('should block absolute paths outside allowed roots', () => {
    // Test with path outside allowed roots (e.g., /etc/passwd on Unix, C:\Windows\System32 on Windows)
    const forbiddenPath = path.sep === '/' ? '/etc/passwd' : 'C:\\Windows\\System32\\config.txt';
    expect(() => resolvePath(forbiddenPath)).toThrow(PdfError);
    expect(() => resolvePath(forbiddenPath)).toThrow('Access denied: Path resolves outside allowed directories.');
  });

  it('should throw PdfError for non-string input', () => {
    // Corrected line number for context
    const userPath = 123 as unknown as string; // Use unknown then cast to string for test
    expect(() => resolvePath(userPath)).toThrow(PdfError);
    expect(() => resolvePath(userPath)).toThrow('Path must be a string.');
    try {
      resolvePath(userPath);
    } catch (e) {
      expect(e).toBeInstanceOf(PdfError);
      expect((e as PdfError).code).toBe(ErrorCode.InvalidParams);
    }
  });

  it('should handle empty string input', () => {
    const userPath = '';
    const expectedPath = path.resolve(PROJECT_ROOT, ''); // Should resolve to the project root itself
    expect(resolvePath(userPath)).toBe(expectedPath);
  });
});
