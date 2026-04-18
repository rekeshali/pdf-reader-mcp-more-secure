// Loads user config from ~/.claude/plugin-settings/pdf-reader.json.
// Missing file or missing sections mean permissive defaults.

import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from './logger.js';

const logger = createLogger('Config');

export interface RuleSet {
  allow: string[];
  deny: string[];
}

export interface PdfReaderConfig {
  path: RuleSet;
  url: RuleSet;
  /** Max size of a local-path PDF in megabytes. Prevents OOM on fs.readFile. */
  maxFileSizeMB: number;
}

const DEFAULT_MAX_FILE_SIZE_MB = 300;

const DEFAULT_CONFIG: PdfReaderConfig = {
  path: { allow: [], deny: [] },
  url: { allow: [], deny: [] },
  maxFileSizeMB: DEFAULT_MAX_FILE_SIZE_MB,
};

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'plugin-settings', 'pdf-reader.json');

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const parseRuleSet = (raw: unknown): RuleSet => {
  if (!raw || typeof raw !== 'object') return { allow: [], deny: [] };
  const obj = raw as Record<string, unknown>;
  const allow = isStringArray(obj['allow']) ? obj['allow'] : [];
  const deny = isStringArray(obj['deny']) ? obj['deny'] : [];
  return { allow, deny };
};

let cached: PdfReaderConfig | null = null;

/**
 * Load and parse the config file. Cached for the process lifetime.
 * Safe to call before Node has initialized the event loop.
 */
export const loadConfig = (): PdfReaderConfig => {
  if (cached) return cached;

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ENOENT') {
      logger.debug('No config file; using permissive defaults', { path: CONFIG_PATH });
    } else {
      logger.warn('Could not read config file; using defaults', {
        path: CONFIG_PATH,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    cached = DEFAULT_CONFIG;
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    logger.warn('Config file is not valid JSON; using defaults', {
      path: CONFIG_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
    cached = DEFAULT_CONFIG;
    return cached;
  }

  if (!parsed || typeof parsed !== 'object') {
    logger.warn('Config root is not an object; using defaults', { path: CONFIG_PATH });
    cached = DEFAULT_CONFIG;
    return cached;
  }

  const obj = parsed as Record<string, unknown>;
  const rawSize = obj['maxFileSizeMB'];
  const maxFileSizeMB =
    typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0
      ? rawSize
      : DEFAULT_MAX_FILE_SIZE_MB;

  cached = {
    path: parseRuleSet(obj['path']),
    url: parseRuleSet(obj['url']),
    maxFileSizeMB,
  };
  return cached;
};

/** Test-only: reset the config cache so subsequent loadConfig() re-reads disk. */
export const _resetConfigCache = (): void => {
  cached = null;
};

export const CONFIG_PATH_FOR_TESTS = CONFIG_PATH;
