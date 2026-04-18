# Security Audit

> Date: 2026-04-18 · Audit head: `59722b3` · Auditor: rma + Claude Opus 4.7
>
> This document is the auditable record behind the security claims in `README.md`. It covers what was audited, how, what was found, what was pruned, and what residual risks remain.

---

## 1. Threat model

**In scope.** Whether this package — its own code, its build artifact, or its dependency tree — can leak PDF content or other host data to external actors without the user's knowledge, on a single-user workstation behind a trusted internal Claude proxy.

**Out of scope.** AI-agent misuse (prompt injection, agent goes rogue), multi-user / shared-server deployment, adversaries with physical or kernel access, side-channel attacks.

---

## 2. First-party code audit (this repo)

Grep targets across `src/` and `dist/`:

```
fetch(  http.  https.  net.  dgram.  WebSocket  XMLHttpRequest  navigator.sendBeacon
axios  got(  node-fetch  request(
exec(  spawn  child_process  eval(  new Function(  vm.
```

| Target | Result | Notes |
|---|---|---|
| Outbound network primitives | None in `src/` or `dist/` other than the user-validated `dns.lookup` in `src/utils/urlValidator.ts` | DNS lookup is part of URL validation (resolves the host so the SSRF floor can check the IP). It is itself network activity but is bounded to user-supplied URLs. |
| Dynamic code execution | None in `src/` or `dist/` | No `eval`, `new Function`, `vm`, `child_process`, `exec`, `spawn`. |
| Telemetry / analytics | None in `src/` or `dist/` | No event-bus dispatch, no fetch beacons, no SDK imports. |
| `postinstall` / `preinstall` scripts in `package.json` | None | The only lifecycle script is `prepare` (lefthook install). |
| File-size cap | None as of `cc5e4f6` | Upstream had a 100 MB hardcoded cap on local-path PDFs. Removed in this fork — fail mode is a clean OOM crash on the MCP process, acceptable for single-user. |
| pdfjs-dist scripting opt-in | Not opted in | `getDocument()` is called without `enableScripting: true`. Default pdfjs-dist behavior is no execution of PDF-embedded JavaScript. |

---

## 3. Runtime dependency audit

Audited from the unpacked `node_modules/` of `bun install --frozen-lockfile --ignore-scripts` against `bun.lock` at audit head.

### Direct runtime deps (5)

| Package | Version | Publisher | Grep result | Notes |
|---|---|---|---|---|
| `pdfjs-dist` | `5.4.530` | Mozilla | `fetch`/`XMLHttpRequest` present (22 hits) — used to load PDFs from URLs and CMap data | Telemetry hooks exist (`reporttelemetry` event dispatch) but they are event-bus dispatches with **no listener wired in our usage**. Used by Mozilla's Firefox PDF viewer; we don't load the viewer. The dispatch sites are in the AnnotationEditor UI code, which we never instantiate. Net effect: telemetry capability dormant. |
| `@sylphx/mcp-server-sdk` | `2.1.1` | Sylphx | Static `import { ... } from "@sylphx/gust"` at top of `dist/index.js` | Sylphx's MCP framework. Eagerly loads `@sylphx/gust` at import time, so the gust HTTP/WS server code is resident in memory even when only `stdio()` transport is used. **None of gust's network code is invoked in our code path** (we removed the `http()` transport branch in `0c58dc9`). |
| `@sylphx/vex` | `0.1.11` | Sylphx | Clean | Schema/validation library. No network, no exec, no eval. |
| `glob` | `13.0.1` | isaacs (npm) | Clean | Filesystem glob matching. No network. |
| `pngjs` | `7.0.0` | (community-maintained) | `browser.js` contains XHR (browser bundle entry) | Node entry point is `lib/png.js` — pure stream/buffer code, no network. We use the Node entry. `browser.js` is not loaded under Node. |
| `minimatch` | `10.2.5` | isaacs (npm) | Clean | Glob matching. Pulled in directly for our `pathUtils` allow/deny matching. |

### Transitive runtime deps via `@sylphx/mcp-server-sdk`

| Package | Version | Grep result | Notes |
|---|---|---|---|
| `@sylphx/gust` | `0.1.13` | Re-exporter | `dist/index.js` is a 3-line re-export of `@sylphx/gust-app` and `@sylphx/gust-server`. |
| `@sylphx/gust-app` | `0.1.9` | WebSocket framing helpers + WASM bridge | All WebSocket primitives are utility functions (no top-level invocation). The WASM file is for performance-critical encoding/decoding; not a network primitive itself. |
| `@sylphx/gust-core` | `0.1.9` | WASM-related code | Internal core for the gust framework. No network calls at module top level. |
| `@sylphx/gust-server` | `0.1.9` | HTTP/WS server class definitions (`class WebSocket extends EventEmitter3`, etc.) | **All function definitions; no top-level invocations.** Server only runs if its `serve()` factory is called by the SDK, which only happens when the SDK's `http()` transport is selected — which we don't use. |
| `@sylphx/vex-json-schema` | `0.0.1` | Clean | JSON-schema bridge for vex. |

### What "telemetry-capable but dormant" means

Two deps in our tree contain telemetry-relevant or network-capable code that we've verified is not invoked in our usage:

1. **pdfjs-dist's `reporttelemetry` event dispatch** — fires only inside the AnnotationEditor UI layer. We never import or instantiate that layer (we use the document/page API directly). No event-bus listener is registered, so even if the dispatch ran, nothing would receive it.
2. **`@sylphx/gust-server`'s HTTP/WebSocket server** — class definitions only at module load. The `serve()` factory has to be called explicitly by the SDK's `http()` transport, which we removed in `0c58dc9`. With `stdio()` transport (our only option after the strip), the server is never instantiated.

This is the strongest claim we can defensibly make from a static audit. To get further would require runtime instrumentation (e.g., monitoring file descriptors and outbound sockets while exercising every code path).

---

## 4. CVE status

`bun audit` against the locked dependency set at audit head: **0 vulnerabilities**.

History:
- Initial audit (post pinning, pre-cleanup): 12 vulnerabilities
  - 3 in `minimatch` (ReDoS) — direct dep, runtime-exposed
  - 1 in `defu` (prototype pollution) — via `@sylphx/bump`, dev-only
  - 1 in `markdown-it`, 1 in `yaml` — via `typedoc`, dev-only
  - 1 in `rollup`, 1 in `vite` — via `vitepress`, dev-only
  - 4 listed twice (both 9.x and 10.x ranges of `minimatch`)
- After patching (`c42a1ca`): 1 moderate (vite, dev-only)
- After dropping vitepress + typedoc (`4e701a8`): **0 vulnerabilities**

---

## 5. Pruned dependencies

Removed from upstream's tree because they served upstream's distribution model (public npm release, docs site, multi-tenant MCP) but not our internal-distribution single-user use case. Each removal closed a transitive-CVE exposure.

| Dep removed | Why upstream had it | Why we don't need it | Removal commit |
|---|---|---|---|
| `vitepress` | Upstream's docs site (`vitepress dev/build/preview`) | We have a README; no docs site | `4e701a8` |
| `typedoc`, `typedoc-plugin-markdown` | API doc generation (`docs:api` script) | Not publishing API docs | `4e701a8` |
| `@sylphx/bump` | Release bump tool used by upstream's `release` script | We don't publish to npm; internal repo handles versioning | `75daaa4` |
| `@sylphx/doctor` | Sylphx's QA tool wired into `prepublishOnly` and lefthook pre-commit/pre-push | Same: we don't publish to npm; lefthook trimmed to format + lint only | `75daaa4` |

**Folders/files removed:**

- `docs/`, `public/`, `vercel.json` — vitepress docs site assets and Vercel deploy config
- `sylphx.json` — Sylphx-specific build config for their CDN
- `CHANGELOG.md`, `CONTRIBUTING.md`, `progress.md` — upstream OSS project artifacts
- `commitlint.config.cjs` — conventional-commit enforcement (optional convention)
- `.github/workflows/ci.yml`, `release.yml` — upstream CI targeting Sylphx self-hosted runners (would not run in our infra)
- `.github/dependabot.yml` — upstream Dependabot config
- `.opencode/`, `opencode.jsonc` — config for OpenCode (a different AI CLI, not ours)

**Lockfile size:** `bun.lock` shrunk from ~1,750 lines (upstream) → 323 lines after pruning.

---

## 6. Hardening changes (code-level)

| Change | Commit | What it closes |
|---|---|---|
| HTTP transport removed (`stdio()` only) | `0c58dc9` | "One env var (`MCP_TRANSPORT=http`) exposes the local file reader to the LAN with `cors:'*'`" footgun. The HTTP server code is no longer reachable. |
| HTTPS-only URL sources | `b38982a` | `http://`, `file://`, `data:`, `blob:`, malformed URLs. Hardcoded floor in `validateUrl`. |
| Built-in SSRF floor | `43fd6ec` | Loopback (`127/8`, `::1`), link-local (`169.254/16`, `fe80::/10`), RFC 1918 private (`10/8`, `172.16/12`, `192.168/16`), IPv6 unique local (`fc00::/7`). The `169.254.169.254` cloud-metadata endpoint is in-scope. Always-on; not removable by user config. |
| User allow/deny config | `43fd6ec` | Optional layer at `~/.claude/plugin-settings/pdf-reader.json` lets you further restrict (host patterns for URLs, path patterns for filesystem reads). Cannot loosen the floor. |
| Exact-pin all deps | `a8018cf` | `package.json` has no `^`/`~`. Combined with `bun.lock` SHA-512 integrity hashes and `--frozen-lockfile`, blocks future-malicious-version auto-install and registry tarball swaps. |
| Plugin install flow | `608336b` | Replaces `npx @sylphx/pdf-reader-mcp` (would pull from public npm) with `claude plugin install . --scope user` from a cloned internal repo. |

---

## 7. Residual risks (accepted)

| Risk | Why we left it |
|---|---|
| **DNS rebinding TOCTOU.** We resolve the URL host once; pdfjs-dist resolves again at fetch time. A malicious DNS server could return different IPs to each lookup. | Closing requires forcing pdfjs to use our pre-validated IP via a custom HTTPS agent. ~50 lines of code. Single-user threat model + no firewall in your deployment plan = accepted residual. |
| **Dependency internals not vendored.** We pinned and locked the dep set, but we don't ship the deps' source in this repo. A malicious version slipped in *before* we pinned would be live. | Static grep + Socket.dev manual cross-check (see Section 8) is the practical mitigation. Vendoring would be the strict-mode answer; not done. |
| **Telemetry-capable code is in the dep tree.** pdfjs-dist's `reporttelemetry` event and `@sylphx/gust-server`'s HTTP server. Both verified dormant in our usage. | Capability presence ≠ active. Verified non-invocation is the strongest static claim available without runtime instrumentation. |
| **No file-size cap.** Upstream's 100 MB local-path cap removed (`cc5e4f6`). | Single-user; an accidental huge file just OOMs the MCP process — Claude reports the error and you correct the path. Multi-user fail-fast not needed. |
| **No path sandbox by default.** Resolved paths are not constrained unless the user adds an allow-list to their config. | OS file-permission boundary is the floor. User can opt into a tighter sandbox via `path.allow` in config if they want. |

---

## 8. External verification (recommended manual pass)

Socket.dev publishes a free public risk analysis per package. We could not fetch these programmatically (their pages 403 to bots) but anyone can browse them in a normal browser.

For each runtime dep, open these in a browser and look for: install scripts, network access, filesystem access, shell spawning, obfuscated code, suspicious imports, recent maintainer changes.

- https://socket.dev/npm/package/@sylphx/mcp-server-sdk
- https://socket.dev/npm/package/@sylphx/vex
- https://socket.dev/npm/package/@sylphx/gust
- https://socket.dev/npm/package/@sylphx/gust-app
- https://socket.dev/npm/package/@sylphx/gust-core
- https://socket.dev/npm/package/@sylphx/gust-server
- https://socket.dev/npm/package/@sylphx/vex-json-schema
- https://socket.dev/npm/package/pdfjs-dist
- https://socket.dev/npm/package/pngjs
- https://socket.dev/npm/package/glob
- https://socket.dev/npm/package/minimatch

Other free public scanners worth knowing about:

- **OSV.dev** — `https://osv.dev/list?ecosystem=npm&q=<package>` — covers known vulns across more ecosystems than `bun audit`.
- **deps.dev** (Google) — `https://deps.dev/npm/<package>` — package metadata, license, dep graph, Scorecard signals.
- **OpenSSF Scorecard** — `https://scorecard.dev/viewer/?uri=github.com/<org>/<repo>` — maintenance/security-practice score for the publishing project.

---

## 9. How to re-audit

This audit is a snapshot. To re-run after any dep change:

1. `bun install --frozen-lockfile --ignore-scripts` — reproducible install.
2. `bun audit` — known CVE check against pinned versions.
3. Grep loop from Section 2 over `node_modules/` of any newly-added or version-bumped dep.
4. Spot-check Socket.dev pages for any new dep.
5. Update this document with the new audit head SHA.

For ongoing automation:
- `pdf-reader-ci.yml` runs `bun audit` on every push and PR.
- `pdf-reader-audit.yml` runs `bun audit` daily — catches newly-disclosed CVEs against already-pinned versions.
