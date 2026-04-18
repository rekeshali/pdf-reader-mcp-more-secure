// URL validation for PDF loader.
// Enforces: https-only, DNS-resolve-then-SSRF-floor check, optional user allow/deny.
//
// Threat model note: there is a small TOCTOU gap between our DNS check here and
// pdfjs-dist's own lookup at fetch time. A DNS-rebinding attacker could return a
// public IP during validation and a private IP at fetch. Accepted for this fork.

import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { loadConfig } from './config.js';
import { ErrorCode, PdfError } from './errors.js';

// Built-in SSRF floor — always enforced, not user-removable.
// IPv4 and IPv6 ranges that point at loopback, link-local, and private networks.
interface CidrRange {
  base: bigint;
  mask: bigint;
  bits: number;
  family: 4 | 6;
}

const parseCidr = (cidr: string): CidrRange => {
  const [addr, prefixStr] = cidr.split('/');
  if (!addr || !prefixStr) throw new Error(`Bad CIDR: ${cidr}`);
  const prefix = parseInt(prefixStr, 10);
  const family = addr.includes(':') ? 6 : 4;
  const bits = family === 4 ? 32 : 128;
  const base = ipToBigInt(addr, family);
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { base: base & mask, mask, bits, family };
};

const ipToBigInt = (ip: string, family: 4 | 6): bigint => {
  if (family === 4) {
    const parts = ip.split('.').map((p) => BigInt(parseInt(p, 10)));
    if (parts.length !== 4) throw new Error(`Bad IPv4: ${ip}`);
    return (parts[0]! << 24n) | (parts[1]! << 16n) | (parts[2]! << 8n) | parts[3]!;
  }
  // IPv6: expand :: and parse hextets
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  if (parts.length !== 8) throw new Error(`Bad IPv6: ${ip}`);
  let out = 0n;
  for (const p of parts) out = (out << 16n) | BigInt(parseInt(p || '0', 16));
  return out;
};

const SSRF_FLOOR: CidrRange[] = [
  parseCidr('127.0.0.0/8'), // IPv4 loopback
  parseCidr('169.254.0.0/16'), // IPv4 link-local (incl. cloud metadata 169.254.169.254)
  parseCidr('10.0.0.0/8'), // RFC 1918 class A
  parseCidr('172.16.0.0/12'), // RFC 1918 class B
  parseCidr('192.168.0.0/16'), // RFC 1918 class C
  parseCidr('::1/128'), // IPv6 loopback
  parseCidr('fc00::/7'), // IPv6 unique local
  parseCidr('fe80::/10'), // IPv6 link-local
];

const matchesAnyCidr = (ip: string, ranges: CidrRange[]): CidrRange | null => {
  const family = ip.includes(':') ? 6 : 4;
  let n: bigint;
  try {
    n = ipToBigInt(ip, family);
  } catch {
    return null;
  }
  for (const r of ranges) {
    if (r.family !== family) continue;
    if ((n & r.mask) === r.base) return r;
  }
  return null;
};

/**
 * Glob-match hostname against a pattern like "*.internal.example.com".
 * `*` matches any characters (including dots). Case-insensitive.
 */
const hostMatches = (host: string, pattern: string): boolean => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return regex.test(host);
};

/**
 * Validate a user-provided URL for the `url:` source.
 * Throws PdfError on any rule violation. Caller passes the source description
 * for clear error messages.
 */
export const validateUrl = async (urlString: string, sourceDescription: string): Promise<URL> => {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new PdfError(ErrorCode.InvalidParams, `Source ${sourceDescription}: invalid URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new PdfError(
      ErrorCode.InvalidParams,
      `Source ${sourceDescription}: only https:// URLs are allowed (got '${parsed.protocol}').`
    );
  }

  const config = loadConfig();
  const host = parsed.hostname;

  // Deny always wins when both match.
  for (const pattern of config.url.deny) {
    if (hostMatches(host, pattern)) {
      throw new PdfError(
        ErrorCode.InvalidParams,
        `Source ${sourceDescription}: host '${host}' is in the configured deny list ('${pattern}').`
      );
    }
  }

  // If allow list is non-empty, host must match one.
  if (config.url.allow.length > 0) {
    const allowed = config.url.allow.some((p) => hostMatches(host, p));
    if (!allowed) {
      throw new PdfError(
        ErrorCode.InvalidParams,
        `Source ${sourceDescription}: host '${host}' is not in the configured allow list.`
      );
    }
  }

  // Resolve the host to IPs and check against the SSRF floor.
  // If the hostname is already an IP literal, skip DNS and check directly.
  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    try {
      const records = await dns.lookup(host, { all: true });
      ips = records.map((r) => r.address);
    } catch (err: unknown) {
      throw new PdfError(
        ErrorCode.InvalidRequest,
        `Source ${sourceDescription}: DNS lookup for '${host}' failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  for (const ip of ips) {
    const match = matchesAnyCidr(ip, SSRF_FLOOR);
    if (match) {
      throw new PdfError(
        ErrorCode.InvalidParams,
        `Source ${sourceDescription}: host '${host}' resolves to ${ip}, which is in a blocked range (SSRF floor).`
      );
    }
  }

  return parsed;
};
