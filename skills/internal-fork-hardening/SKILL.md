---
name: internal-fork-hardening
description: Take a third-party MCP server (or similar Node/JS/Python package) and harden it for single-user installation behind an internal Claude proxy. Always start from a formal GitHub fork (never a hard-fork). Codifies threat-model framing, layered controls (scheme floor + SSRF deny + user allow/deny), audit documentation, supply-chain pinning, dep-tree pruning, and CI workflow patterns proven on the pdf-reader-mcp-more-secure fork.
version: 1.0.0
source: local-git-analysis
analyzed_commits: 18
applies_to:
  - "third-party Node/TypeScript packages distributed via internal repo"
  - "Claude Code plugin packaging (.claude-plugin/, .mcp.json, install scripts)"
  - "single-user deployment threat models (secured-internal-network locked-down workstation)"
---

# Internal Fork Hardening

A repeatable workflow for taking an upstream npm/Node package and shipping a hardened internal-only fork. Captures decisions that paid off on `pdf-reader-mcp-more-secure` so the next fork doesn't re-discover them.

## When to use this skill

- User says "fork [package] for use on a [restricted] machine" or similar.
- User wants to install a third-party MCP server via internal distribution rather than public npm.
- User describes a threat model that's narrower than upstream's (single-user, not multi-tenant).
- Any time you're auditing a third-party JS package and need a place to write down what you found.

## Phase 0 — always formal fork

Continuing someone else's work means starting from a real fork. Not a clone, not a hard-fork, not a copy-paste. **Always:**

```bash
gh repo fork <upstream-org>/<upstream-repo> --fork-name <new-name> --clone
```

This is non-negotiable for hardening forks because:

1. **Attribution.** The upstream maintainer did most of the work. The "forked from" badge on GitHub tells everyone — your colleagues, future maintainers, license auditors — that this is derivative. Hiding lineage is dishonest.
2. **License compliance.** Most OSS licenses (MIT, Apache, AGPL) require preserving copyright notices and acknowledging the original work. A formal fork does this implicitly via the GitHub relationship; a hard-fork makes it your responsibility to remember.
3. **Upstream patches.** Security CVEs and bug fixes get pushed to upstream. A formal fork lets you `git fetch upstream && git diff upstream/main -- src/` to see what changed and decide whether to merge. A hard-fork is blind to all of it.
4. **Drift visibility.** If you've drifted significantly from upstream, that's worth knowing — and only the formal fork makes it queryable.

After forking, **record the import SHA** in `.upstream-sha` so any future audit can answer "what version did we start from?" without spelunking the GitHub UI:

```bash
git rev-parse upstream/main > .upstream-sha
```

The `upstream` remote is added automatically by `gh repo fork --clone`. Keep it. Fetch from it before every release cycle to surface upstream changes you may need to incorporate.

---

## Core framing — start here

Before any code change, write the threat model down explicitly. This blocks scope creep and produces docs you can defend later.

**Three sections, in this order:**

1. **In scope** — narrow as possible. For pdf-reader, it was: "can this package, by itself, leak content to external actors without the user's knowledge?"
2. **Out of scope** — louder than the in-scope. *Always* call out: AI-agent prompt injection, multi-user/shared-server deployment, physical/kernel access. These are real risks, but not what this fork addresses.
3. **Operating conditions** — numbered list of preconditions that must hold for the security claims to apply. Include "installed from internal repo, not public npm" as #1. End with: *"if any of these conditions is not met, treat this fork as equivalent to the upstream package."*

Every later decision references these. Don't add a control that doesn't trace back to a threat-model item.

## Hardening layers — apply in this order

Each layer is independent and can be done as a single commit. Order matters: the floor controls go first because the user controls (next layer) sit on top of them.

### 1. Cut accidental egress paths first

The cheapest wins are usually upstream features that don't apply to your deployment. For pdf-reader: an HTTP transport mode bound to `0.0.0.0` with `cors: '*'` that activated on a single env var. We deleted the entire `http()` branch.

Look for: alternative transports, telemetry opt-ins, "for development convenience" flags, debug HTTP endpoints. If your deployment doesn't need it, **delete it from the source** rather than disabling via config — config can be re-enabled by accident.

### 2. Hardcoded floor on user-controllable inputs

For any input that can name a destination (URL, file path, hostname), add a non-removable floor:

- **URLs:** `https:` only. Reject `http:`, `file:`, `data:`, `blob:`, malformed. Then DNS-resolve the host and reject any resolved IP in the **SSRF block list**: loopback (`127/8`, `::1`), link-local (`169.254/16`, `fe80::/10`), RFC 1918 private (`10/8`, `172.16/12`, `192.168/16`), IPv6 ULA (`fc00::/7`). Cloud-metadata endpoint `169.254.169.254` is in the link-local range. Document this floor as **always-on, not user-removable** — even if a user adds `*` to their allow list, the floor still applies.
- **Paths:** no hardcoded floor needed if the OS file-permission boundary is acceptable. The user-config layer (next) handles this.

### 3. User-configurable allow/deny on top

Optional, fail-permissive when absent. File location: `~/.claude/plugin-settings/<tool>.json`. Schema:

```json
{
  "path": { "allow": [], "deny": [] },
  "url":  { "allow": [], "deny": [] }
}
```

Semantics that have proven correct:
- **Glob via minimatch** for path patterns (with `~` expansion). Wildcard regex for URL hosts (`*` matches any chars, case-insensitive).
- **Empty `allow` = permissive** for that input type; non-empty `allow` = whitelist mode (must match one).
- **Deny wins** on conflict. Fail-closed.
- **Floor cannot be loosened** by user config. URL allow `*` doesn't permit `127.0.0.1`.
- **No hot-reload.** Cache the config on first read; document that changes require server restart.

### 4. Supply-chain pinning

- `package.json`: drop every `^` and `~`. All direct deps and devDeps pinned exactly.
- Commit `bun.lock` (or `package-lock.json`). It contains SHA-512 integrity hashes that block tarball swaps.
- Use `bun install --frozen-lockfile --ignore-scripts` (or `npm ci --ignore-scripts`) in install scripts and CI.
- `--ignore-scripts` blocks lifecycle code execution from any transitive dep, present or future.

### 5. Prune what you don't need

Upstream packages bundled for public distribution typically carry deps you don't use. For each:

- **Docs site infra** (vitepress, typedoc, vercel.json) — delete if you have a README.
- **Release tooling** (semantic-release, standard-version, custom bump tools) — delete if you publish via a different pipeline.
- **Upstream CI** — delete if it targets infrastructure you don't control (self-hosted runners, etc.). Replace with your own.
- **Other-tool configs** (`.opencode/`, `.windsurf/`, etc.) — delete unless you actually use them.

Each removal closes a transitive-CVE attack surface AND shrinks the audit footprint. On pdf-reader: `bun.lock` went from ~1,750 lines → 323. Twelve `bun audit` findings → zero.

### 6. Plugin-style install (Claude Code specifically)

Add `.claude-plugin/plugin.json` (just `{"name": "..."}` minimum) and a `.mcp.json` at repo root using `${CLAUDE_PLUGIN_ROOT}/dist/index.js` so the plugin is relocatable. Install via `claude plugin install . --scope user`. Provide `install.sh` / `uninstall.sh` / `enable.sh` / `disable.sh` wrapper scripts. Each is `set -euo pipefail`, idempotent, and ~20 lines.

## Audit document pattern

Write a `SECURITY-AUDIT.md` alongside `README.md`. The README states claims; SECURITY-AUDIT.md is the receipts.

Sections that proved load-bearing:

1. **Threat model** — restated from README, single page.
2. **First-party code grep findings** — exact patterns searched, results table.
3. **Per-dep audit** — version, publisher, grep result, capabilities flagged as "present but dormant" with explanation of why they're unreachable.
4. **CVE history** — `bun audit` over time. Show the arc (12 → 1 → 0) so future-you can see the work.
5. **Pruned deps table** — what you removed and why, with commit refs.
6. **Hardening changes table** — one row per code change, what it closes.
7. **Residual risks** — things you intentionally didn't fix and why. (DNS rebinding, dep-internals-not-vendored, unaudited Sylphx packages, etc.)
8. **External verification** — Socket.dev URLs, OpenSSF Scorecard data (where indexed), OSV.dev. Include scores in a table; note where coverage is missing.
9. **Re-audit recipe** — five steps to reproduce after any dep change.

## CI workflows

Two files at `.github/workflows/`, named with the tool prefix (`<tool>-ci.yml`, `<tool>-audit.yml`) so they're distinguishable in a monorepo.

- **`<tool>-ci.yml`** — push to main + PR. `bun install --frozen-lockfile --ignore-scripts`, then `bun audit`, `bun test`, `bun run build`. The workflow file fails on issues — branch protection / rulesets enforce merge blocking (configured outside the workflow).
- **`<tool>-audit.yml`** — daily cron + `workflow_dispatch`. Just `bun install` + `bun audit`. Default GitHub behavior: emails on failure only. Catches newly-disclosed CVEs against already-pinned versions (push-based CI can't see these — code didn't change, advisory did).

Both files start with a `TOOL_PATH` env var (`'.'` for standalone, `'<subfolder>'` after monorepo move) and a `# CHANGE-AFTER-MOVE` marker for the two `paths:` filters that env can't resolve.

## Cleanup workflow

When ripping out unneeded surface area, **stage it explicitly**: "stage 1 of 3", "stage 2 of 3". Between each stage:

1. `bun install --ignore-scripts` (lockfile updates as deps drop)
2. `bun test` (full suite must pass)
3. `bun run build` (dist must rebuild)
4. `bun audit` (vuln count should monotonically decrease)
5. Commit the stage with a message that lists exactly what was removed and what the audit/test outcome was.

This makes each stage independently revertible and each commit independently reviewable.

## Commit conventions (validated on this fork)

- **Conventional commits with scopes:** `feat(loader):`, `feat(transport):`, `feat(security):`, `chore(deps):`, `docs(audit):`, `revert:`, `ci:`, `chore:`. Scope names typically match a source file or domain.
- **Co-author trailer for AI-assisted commits:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` on every commit Claude wrote.
- **`revert:` as a first-class type**, not a `git revert`. Use it when a previously-committed feature was decided against; the commit body explains *why we changed our mind*, not just what's being undone. Example: `revert: remove file-size cap entirely (single-user threat model)`.
- **Stage suffixes** when doing multi-commit cleanups: `(stage 1 of 3)`.

## Pitfalls — calibrated from real mistakes

- **`vi.mock` leaks across files under `bun test`.** Module-level `vi.mock(...)` in one test file affects imports in *other* test files in the same run. Use `vi.spyOn` with `afterAll` restoration instead, and mock Node built-ins (e.g., `node:dns/promises`) rather than internal modules where possible.
- **Default vs namespace imports affect `vi.spyOn` matching.** If `config.ts` does `import fs from 'node:fs'` (default) and the test does `import * as fs` (namespace), they reference different objects and the spy doesn't take. Use `import * as fs` in both, or use the namespace consistently.
- **Plugin install copies into a cache.** `claude plugin install <path>` copies the plugin source. Editing your clone after install does nothing until you re-install. Document this in the README so users don't lose an hour debugging.
- **`${CLAUDE_PLUGIN_ROOT}` only resolves inside the plugin context.** A project-scope `.mcp.json` using that variable will fail to spawn when someone opens the repo as a project. Cosmetic but confusing — call it out as a known false-error in docs.
- **External reviewers will read stale snapshots.** When an LLM auditor reviews your repo, they may be looking at an old commit. If their findings reference code you've already changed, that's their bug, not yours. Verify which SHA they reviewed.
- **Default user-config behavior matters more than the schema.** Empty allow + empty deny + present floor = "permissive within the floor." Document this default explicitly. Users will assume worst-case otherwise.

## File-by-file output checklist

For a fork following this skill, expect to produce:

```
.claude-plugin/plugin.json          (1 line: {"name": "..."})
.mcp.json                           (4 lines: stdio + ${CLAUDE_PLUGIN_ROOT})
.mcp.dev.json                       (upstream's dev MCP config, archived)
.github/workflows/<tool>-ci.yml     (push/PR validation)
.github/workflows/<tool>-audit.yml  (daily cron audit)
install.sh                          (verify + claude plugin install + drop config template)
uninstall.sh                        (claude plugin uninstall)
enable.sh / disable.sh              (toggle without reinstall)
src/utils/config.ts                 (loadConfig from ~/.claude/plugin-settings/<tool>.json)
src/utils/urlValidator.ts           (scheme + DNS + SSRF floor + user allow/deny)
test/utils/config.test.ts
test/utils/urlValidator.test.ts
test/utils/<scope>.allowDeny.test.ts
README.md                           (fork-specific, with "Why this fork" framing)
README.OG.md                        (upstream README preserved)
SECURITY-AUDIT.md                   (the receipts)
```

Files to remove from typical upstream packages:

```
docs/  public/  vercel.json  CHANGELOG.md  CONTRIBUTING.md
.github/workflows/  .github/dependabot.yml
.opencode/  opencode.jsonc  .windsurf/
release-config files (standard-version, semantic-release configs)
prepublishOnly hooks for tools you don't have
```

## Reference

The pdf-reader-mcp-more-secure fork at `github.com/rekeshali/pdf-reader-mcp-more-secure`, commits `608336b` through `7453871` on `main`, is the worked example. Each hardening layer corresponds to a commit; each pruning stage to another. The audit document `SECURITY-AUDIT.md` shows what reproducing the audit looks like in practice.
