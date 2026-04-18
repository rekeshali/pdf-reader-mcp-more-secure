# pdf-reader-mcp (hardened fork)

A security-hardened fork of [@sylphx/pdf-reader-mcp](https://github.com/SylphxAI/pdf-reader-mcp), packaged as a Claude Code plugin for internal distribution. The upstream README is preserved as [`README.OG.md`](./README.OG.md).

---

## What this fork is for

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
4. User installs with `--ignore-scripts --omit=optional` if rebuilding from source.
5. OS-level egress control (firewall, Little Snitch, etc.) is in place as a backstop — **strongly recommended**.

If any of these conditions is not met, treat this fork as equivalent to the upstream package.

---

## What we changed vs upstream

| Hardening | Details |
|---|---|
| HTTPS-only URL sources | `url:` sources are rejected unless the scheme is `https:`. `http:`, `file:`, `data:`, `blob:`, and malformed URLs all fail at load time in `src/pdf/loader.ts`. |
| HTTP transport removed | `MCP_TRANSPORT`, `MCP_HTTP_*`, and `MCP_API_KEY` env vars and the entire `http()` branch are deleted. Transport is stdio-only. Removes the "one env var exposes a local file reader to the LAN with `cors:*`" footgun. |
| Exact-pin all deps | `package.json` has no `^`/`~`: every direct dep resolves to a single version. Combined with the committed `bun.lock` and `--frozen-lockfile` on rebuild, supply-chain attackers can't auto-deliver a newer malicious version, and registry tarball swaps are blocked by the lockfile's SHA-512 integrity hashes. |
| Plugin install flow | Packaged as a Claude Code plugin with `.claude-plugin/plugin.json` and a `${CLAUDE_PLUGIN_ROOT}`-based `.mcp.json`. Install/uninstall/enable/disable scripts provided. |

Things we reviewed but intentionally did *not* change:
- **No path allow-list.** Single-user assumption; the OS file-permission boundary is considered sufficient.
- **No SSRF deny-list beyond the scheme check.** HTTPS to private IPs (`localhost`, `169.254.169.254`, RFC 1918) is not blocked in code. If you need that guarantee, use an OS-level firewall rule.

---

## What we audited and found clean

- No outbound network calls in `src/` or `dist/` outside user-requested URL fetches. No `fetch`, `http`, `axios`, WebSocket, `dgram`.
- No dynamic code execution — no `eval`, `new Function`, `vm`, `child_process`, `exec`, `spawn`.
- No telemetry or analytics.
- No `postinstall` / `preinstall` scripts in `package.json`.
- 100 MB file-size cap at `src/pdf/loader.ts:20` prevents memory-exhaustion DoS.
- `pdfjs-dist` is invoked without `enableScripting: true`, so JavaScript embedded in PDFs does not execute.

Runtime dependency tree: `@sylphx/mcp-server-sdk`, `@sylphx/vex`, `pdfjs-dist`, `pngjs`, `glob`. Root of trust is Sylphx (publisher of the `@sylphx/*` packages) plus Mozilla (pdfjs-dist), isaacs (glob), and the pngjs maintainers.

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
3. **`https://localhost/...` and private-IP URLs are still permitted.** The validator blocks schemes, not destinations. If you need to prevent SSRF to internal services, add an OS-level firewall rule.
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

**Supply-chain discipline:** dep updates must go through a PR that changes both `package.json` and `bun.lock`, with human review of the lockfile diff. Do not run `bun update` or `bun install` without `--frozen-lockfile` on the release branch.

---

## Dev-time notes

- The upstream project's dev-time MCP config (context7, grep, playwright) has been moved to `.mcp.dev.json` for reference. It is not loaded by default.
- Run the test suite: `bun test` (137 pass, 7 skip as of last commit).
- Rebuild: `bun run build`.

---

## License

MIT, inherited from upstream. See [`LICENSE`](./LICENSE).
