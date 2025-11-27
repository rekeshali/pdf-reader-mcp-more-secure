// Removed unused import: import { fileURLToPath } from 'url';

import os from 'node:os';
import path from 'node:path';
import { ErrorCode, PdfError } from './errors.js';

// Use the server's current working directory as the project root.
// This relies on the process launching the server to set the CWD correctly.
export const PROJECT_ROOT = process.cwd();

// Define allowed root directories for file access
// Users can access files in the project root or their home directory
const ALLOWED_ROOTS = [PROJECT_ROOT, os.homedir()];

// Removed console.info to prevent stderr pollution during MCP initialization
// This was causing handshake failures with some MCP clients (e.g., Codex)
// Debug logging can be enabled via DEBUG_MCP environment variable in index.ts

/**
 * Resolves a user-provided path, accepting both absolute and relative paths.
 * Relative paths are resolved against the current working directory (PROJECT_ROOT).
 * Validates that the resolved path stays within allowed directories to prevent path traversal attacks.
 * @param userPath The path provided by the user (absolute or relative).
 * @returns The resolved absolute path.
 * @throws {McpError} If path is invalid or resolves outside allowed directories.
 */
export const resolvePath = (userPath: string): string => {
  if (typeof userPath !== 'string') {
    throw new PdfError(ErrorCode.InvalidParams, 'Path must be a string.');
  }

  const normalizedUserPath = path.normalize(userPath);

  // Resolve the path (absolute paths stay as-is, relative paths resolve against PROJECT_ROOT)
  const resolvedPath = path.isAbsolute(normalizedUserPath)
    ? normalizedUserPath
    : path.resolve(PROJECT_ROOT, normalizedUserPath);

  // Security: Validate that resolved path stays within allowed directories
  const isWithinAllowedRoot = ALLOWED_ROOTS.some((allowedRoot) => {
    const relativePath = path.relative(allowedRoot, resolvedPath);
    // Path is safe if:
    // 1. relativePath is not empty (resolvedPath is not the root itself)
    // 2. relativePath doesn't start with '..' (no parent directory traversal)
    // 3. relativePath is not absolute (didn't escape to different root)
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  });

  if (!isWithinAllowedRoot) {
    throw new PdfError(
      ErrorCode.InvalidParams,
      'Access denied: Path resolves outside allowed directories.'
    );
  }

  return resolvedPath;
};
