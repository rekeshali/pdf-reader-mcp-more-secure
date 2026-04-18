# pdf-reader-mcp (hardened fork)

A security-hardened fork of [@sylphx/pdf-reader-mcp](https://github.com/SylphxAI/pdf-reader-mcp), packaged as a Claude Code plugin for internal distribution. The upstream README is preserved as [`README.OG.md`](./README.OG.md).

---

## What this is

An **MCP server** (Model Context Protocol — the stdio-based plugin interface Claude Code uses to expose local tools to the agent) that lets Claude read PDFs. Once installed, a single tool becomes available in every Claude Code session:

- `read_pdf` — given one or more sources (local file paths or HTTPS URLs), returns any combination of full text, per-page text, embedded images, tables, and document metadata. Supports page ranges (`"1-5,10,15-20"`), multi-document batching, and Y-coordinate-ordered output so extracted content preserves the document's reading flow.

You don't invoke it directly. You tell Claude something like *"summarize `~/Downloads/paper.pdf`"* or *"pull the tables from https://internal.example.com/report.pdf"* — Claude decides to call `read_pdf`, gets back structured text/images/tables, and works from there. Useful for research reading, manual lookup, spec review, anything where a PDF is the source and you want the model to ground its answer in it instead of guessing.

Feature parity with upstream is intentional; we didn't change what the tool *does*, only how it's distributed and what it's allowed to reach on your network and filesystem.

---

## Why this fork

A single-user PDF reader for Claude Code on a locked-down personal workstation (e.g. an engineering laptop behind an internal Claude proxy). It answers one narrow concern:

> *Can this third-party package, by itself, leak PDF contents to external actors without the user's knowledge?*

It is **not** a hardened-for-shared-deployment package and it does **not** try to mitigate AI-agent misuse.

---

## Threat model

### In scope
- The package code and its direct/transitive dependencies as a potential data-exfil vector.
- Accidental network egress (HTTP transport footguns, unrestricted URL fetching).
- Supply-chain install-time code execution.

### Explicitly out of scope
- **AI-agent risks** (prompt injection, agent misuse). These need to be mitigated at the agent/policy layer, not here.
- **Multi-user or shared-server deployments.** One user, one machine.
- **Adversaries with physical or kernel access to the machine.**

### Operating conditions under which this fork is considered secure

1. Installed from your organization's internal repo, not public npm.
2. Claude Code CLI uses only a trusted (internal) model proxy.
3. Single-user personal machine — not a shared server, not exposed as a LAN service.
4. Rebuilds use `bun install --frozen-lockfile --ignore-scripts` (blocks lockfile drift and install-time code in transitive deps).

If any of these conditions is not met, treat this fork as equivalent to the upstream package.

---

## What we changed vs upstream

Hardening stacks as **hardcoded floor** (always on, not configurable) + **user layer** (optional additional restrictions on top). The user layer can narrow access further but cannot loosen the floor.

| Hardening | Details |
|---|---|
| Hardcoded URL floor | Two checks that can't be disabled or weakened. **(1) Scheme must be `https:`** — `http:`, `file:`, `data:`, `blob:`, and malformed URLs are rejected at load time. **(2) SSRF block list** — every resolved IP is checked against loopback (`127/8`, `::1`), link-local (`169.254/16`, `fe80::/10`), RFC 1918 private (`10/8`, `172.16/12`, `192.168/16`), and IPv6 unique local (`fc00::/7`). The `169.254.169.254` cloud-metadata endpoint is in-scope. |
| HTTP transport removed | `MCP_TRANSPORT`, `MCP_HTTP_*`, and `MCP_API_KEY` env vars and the entire `http()` branch are deleted. Transport is stdio-only. Removes the "one env var exposes a local file reader to the LAN with `cors:*`" footgun. |
| User-configurable layer (optional) | JSON config at `~/.claude/plugin-settings/pdf-reader.json` lets you add allow/deny rules on top of the floor: hostname patterns for `url:` sources and path patterns for `path:` sources. Shell-glob syntax, deny wins on conflict. Cannot override the floor — if your allow list permits a host that resolves to a blocked IP, the request is still rejected. See the **User config** section below. |
| Exact-pin all deps | `package.json` has no `^`/`~`: every direct dep resolves to a single version. Combined with the committed `bun.lock` and `--frozen-lockfile` on rebuild, supply-chain attackers can't auto-deliver a newer malicious version, and registry tarball swaps are blocked by the lockfile's SHA-512 integrity hashes. |
| Plugin install flow | Packaged as a Claude Code plugin with `.claude-plugin/plugin.json` and a `${CLAUDE_PLUGIN_ROOT}`-based `.mcp.json`. Install/uninstall/enable/disable scripts provided. |
| File-size cap removed | Upstream had a 100 MB cap on local-path PDFs as a fail-fast guard against memory exhaustion in multi-tenant deployments. Dropped here — single-user threat model means an accidental huge file just crashes the MCP process (Claude reports the error and you retry with a smaller file). One less config knob, no functional restriction. |

---

## What we audited and found clean

- No general-purpose outbound network client code in this repo's source or built artifact. No `fetch`, `http`, `axios`, WebSocket, `dgram`. The only network operations are: (1) the user-requested HTTPS fetch for a `url:` source, performed by pdfjs-dist; and (2) a `dns.lookup` we run during URL validation to resolve the host before applying the SSRF floor.
- No dynamic code execution primitives in this repo's source or built artifact — no `eval`, `new Function`, `vm`, `child_process`, `exec`, `spawn`.
- No telemetry or analytics in this repo's source or built artifact.
- Runtime dependencies (`@sylphx/*`, `pdfjs-dist`, `pngjs`, `glob`, `minimatch`) were grep-audited from their unpacked source for the same primitives. Two findings were verified as **dormant in our usage**: pdfjs-dist's `reporttelemetry` event dispatch (only fires inside the AnnotationEditor UI layer, which we never load) and `@sylphx/gust-server`'s HTTP/WebSocket server (only invoked by the `http()` transport, which we removed). Full per-dep findings in [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md).
- No `postinstall` / `preinstall` scripts in `package.json`.
- This fork does not opt into PDF.js scripting (`enableScripting: true` is never set). PDF.js's default is to not execute embedded JavaScript.

Runtime dependency tree: `@sylphx/mcp-server-sdk`, `@sylphx/vex`, `pdfjs-dist`, `pngjs`, `glob`, `minimatch`. Root of trust is Sylphx (publisher of the `@sylphx/*` packages) plus Mozilla (pdfjs-dist), isaacs (glob/minimatch), and the pngjs maintainers.

---

## Installation

**Prereqs:** `node >=22`, `claude` CLI logged in.

```bash
git clone <your-internal-repo-url>
cd pdf-reader-mcp-more-secure
./install.sh
```

`install.sh` runs `claude plugin install . --scope user`, which copies the plugin into Claude's plugin cache. After install, the clone directory can be moved or deleted — the plugin lives in the cache.

**Verify:**

```bash
claude plugin list       # should list: pdf-reader
```

Inside a Claude session:

```
/mcp
```

should show `pdf-reader` as a connected server.

---

## User config

Optional. File location: **`~/.claude/plugin-settings/pdf-reader.json`** (the template is created on first `./install.sh` if missing). All fields optional; missing fields = permissive defaults. If the file is missing or malformed, the server logs a warning and runs with empty rules.

```json
{
  "path": {
    "allow": ["~/Documents/claude-pdfs/**"],
    "deny":  ["~/.ssh/**", "~/.aws/**"]
  },
  "url": {
    "allow": ["*.internal.example.com", "docs.corp.example.com"],
    "deny":  ["evil.example.com"]
  }
}
```

**Semantics:**
- `path` rules apply to the `path:` source; `url` rules apply to the `url:` source (host match).
- Patterns are shell globs (minimatch). Paths support leading `~` expansion.
- If `allow` is non-empty, the input **must** match one entry. Empty allow = any.
- `deny` is checked too. **Deny wins** when both match — fail-closed on conflict.
- URL rules match the hostname, not the full URL. `*` matches any characters including dots (wildcard-cert style).
- Changes take effect on the **next server start**. No hot-reload. Toggle with `./disable.sh && ./enable.sh`.

**Always-on SSRF floor:** the built-in block list (loopback / link-local / RFC 1918 / ULA / fe80 / `169.254.169.254`) is enforced regardless of this config. The user `url.allow` list cannot permit a host that resolves to one of those ranges.

**Known caveat — DNS rebinding:** we resolve the URL host at validation time, then pdfjs-dist resolves it again at fetch time. An attacker controlling DNS for an allow-listed host could return a public IP for our lookup and a private IP for pdfjs's. Closing this gap would require forcing pdfjs to connect to the IP we validated (via a custom HTTPS agent). We haven't done that here — accepted residual for this fork.

---

## Usage

Once installed, the `read_pdf` tool is available in any Claude Code session. Ask naturally:

> Read `/path/to/doc.pdf` and summarize the intro.
>
> Summarize https://internal.example.com/manuals/foo.pdf — just the executive summary.

The tool supports text extraction, metadata, page counts, page ranges, images, and tables. See [`README.OG.md`](./README.OG.md) for the full tool schema and parameters.

---

## Update, disable, uninstall

```bash
./disable.sh      # stop Claude from loading it (plugin stays installed)
./enable.sh       # turn it back on
./uninstall.sh    # fully remove the plugin
```

To update: `git pull` in your clone, then re-run `./install.sh`. Because the plugin is cached at install time, pulling alone does nothing — the re-install step is required to copy the new build into the cache.

---

## Gotchas

1. **Plugin cache is not a live link.** The plugin directory Claude loads is a *copy* made at install time. Editing files in your clone has no effect until you re-run `./install.sh`.
2. **Opening this repo in Claude Code will show a cosmetic `pdf-reader` failure.** The tracked `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}`, which only resolves inside the plugin context. If you open the repo directory as a project, Claude tries to spawn `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js` and fails. Ignore it — the installed plugin is unaffected.
3. **DNS rebinding is not closed in code.** We validate the host's resolved IP, but pdfjs-dist does a second lookup when it fetches. A malicious DNS server could return a clean IP to us and a blocked IP to pdfjs. Documented in **User config**; accepted residual.
4. **Node must be on `PATH` when Claude spawns the server.** If you use `nvm` or `asdf`, ensure Claude inherits a shell with node available, or you'll get `node: command not found` in the MCP log.
5. **Re-running `./install.sh` fully replaces the prior install.** Idempotent by design. If plugin-scoped data ever matters to you, pass `--keep-data` manually to `claude plugin uninstall`.

---

## Rebuilding from source

Only needed if `dist/index.js` is missing or you're modifying code:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run build
```

- `--frozen-lockfile` refuses to modify `bun.lock`; if any resolution would change, the install fails loudly instead of silently drifting.
- `--ignore-scripts` blocks install-time code execution in transitive deps (lifecycle scripts do not run).
- The native `@napi-rs/canvas` optional dep is not installed by default with `--ignore-scripts` on bun, and isn't needed for text, metadata, or image extraction.

---

## Supply-chain and CI

Two workflows live at `.github/workflows/`:

- **`pdf-reader-ci.yml`** — runs on push to `main` and on PRs. Installs with `--frozen-lockfile --ignore-scripts`, then runs `bun audit` (GitHub Advisory DB), the test suite, and the build. The workflow fails on any of those failing; merge-blocking on PRs requires GitHub branch protection or rulesets to be configured to enforce it (set up at the repo level, not in the workflow file).
- **`pdf-reader-audit.yml`** — runs daily at 13:00 UTC plus on-demand. Catches newly-disclosed CVEs that land against already-pinned versions (push-based CI can't detect these — the code didn't change, but the advisory did). Default GitHub behavior emails repo owners only on failure.

Both files expose a single `TOOL_PATH` env at the top so they can drop into a monorepo with a one-line edit. Grep for `CHANGE-AFTER-MOVE` when relocating.

**Dep-update discipline:** changes must go through a PR that modifies both `package.json` and `bun.lock`, with human review of the lockfile diff. Do not run `bun update` or `bun install` without `--frozen-lockfile` on the release branch.

---

## Dev-time notes

- The upstream project's dev-time MCP config (context7, grep, playwright) has been moved to `.mcp.dev.json` for reference. It is not loaded by default.
- Run the test suite: `bun test` (167 pass, 7 skip as of last commit).
- Rebuild: `bun run build`.

---

## License

MIT, inherited from upstream. See [`LICENSE`](./LICENSE).
