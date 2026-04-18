import os from 'node:os';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { loadConfig } from './config.js';
import { ErrorCode, PdfError } from './errors.js';

// Use the server's current working directory as the project root.
// This relies on the process launching the server to set the CWD correctly.
export const PROJECT_ROOT = process.cwd();

/**
 * Expand a leading `~` or `~/` in a path pattern.
 * Does not touch `~user/` (not supported).
 */
const expandTilde = (p: string): string => {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
};

const matchesAnyPattern = (resolvedPath: string, patterns: string[]): string | null => {
  for (const raw of patterns) {
    const pattern = expandTilde(raw);
    if (minimatch(resolvedPath, pattern, { dot: true })) return raw;
  }
  return null;
};

/**
 * Resolves a user-provided path and applies configured allow/deny rules.
 *
 * - Absolute paths stay as-is after normalization.
 * - Relative paths resolve against PROJECT_ROOT.
 * - Deny wins when both match (fail-closed on conflict).
 * - Allow list being non-empty means only matching paths are permitted.
 *
 * @throws {PdfError} If path is invalid or rejected by the allow/deny rules.
 */
export const resolvePath = (userPath: string): string => {
  if (typeof userPath !== 'string') {
    throw new PdfError(ErrorCode.InvalidParams, 'Path must be a string.');
  }

  const normalizedUserPath = path.normalize(userPath);
  const resolved = path.isAbsolute(normalizedUserPath)
    ? normalizedUserPath
    : path.resolve(PROJECT_ROOT, normalizedUserPath);

  const config = loadConfig();

  // Deny wins.
  const denyHit = matchesAnyPattern(resolved, config.path.deny);
  if (denyHit) {
    throw new PdfError(
      ErrorCode.InvalidParams,
      `Path '${resolved}' is in the configured deny list ('${denyHit}').`
    );
  }

  // If allow list is non-empty, path must match one.
  if (config.path.allow.length > 0) {
    if (!matchesAnyPattern(resolved, config.path.allow)) {
      throw new PdfError(
        ErrorCode.InvalidParams,
        `Path '${resolved}' is not in the configured allow list.`
      );
    }
  }

  return resolved;
};
