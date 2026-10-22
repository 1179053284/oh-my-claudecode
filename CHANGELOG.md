# oh-my-claudecode v5.7.8: More reliable Windows workers and configuration handling

## Release Notes

This release improves native Windows worker supervision, JSON and JSONC parsing, numeric configuration validation, think-mode matching, diagnostic environment handling, and prerelease update ordering. Thanks to @rudycelekli for contributions to #4493, #4494, #4497, #4499, #4508, #4510, and #4511.

### Bug Fixes

- **fix(team): repair native Windows worker supervision and startup** (#4479, fixes #4386)
- **fix(team): fit the source-bound Windows supervisor invocation and reject unresolved provider executables** (#4479)
- **fix(team): submit tmux startup inboxes and shorten only overflowing Windows notifications** (#4479)
- **fix(team): recognize Codex folder-trust prompts without sending task text or granting persistent trust** (#4479)
- **fix(jsonc): accept a leading UTF-8 BOM in JSONC configuration files** (#4494)
- **fix(notifications): reject non-positive reply polling intervals and rate limits** (#4497)
- **fix(json): accept a leading UTF-8 BOM in hand-authored JSON files** (#4499)
- **fix(think-mode): match multilingual think keywords as whole words** (#4493)
- **fix(debug): read `OMC_DEBUG` through one shared convention** (#4508)
- **fix(host-load-gate): reject malformed thresholds instead of silently truncating them** (#4510)
- **fix(version): rank prereleases below their corresponding release** (#4511)

### Other Changes

- **test(ci): make SessionStart timing tests deterministic** (#4514)
- **ci:** canonicalize generated-artifact authorization timestamps and refresh authorization entries for release and sync PRs (#4480, #4504, #4507, #4509)
- **chore(inventory): rebuild generated artifacts and inventory during the v5.7.7 main-to-dev sync** (#4506)

---

# oh-my-claudecode v5.7.7: Codex hook compatibility and safer HUD loading

## Release Notes

This release includes fixes for Codex hook output, HUD fallback security and reliability, configuration parsing, team shutdown validation, and plugin-only bootstrap.

### Bug Fixes

- **fix(hooks): emit Codex-compatible PreToolUse output** (#4489, fixes #4488)
- **fix(hud): restrict npm fallback to the global prefix** (#4471, #4472)
- **fix(hooks): fall back from blank shell config directory overrides** (#4474)
- **fix(hooks): honor trailing commas in agent model JSONC** (#4473)
- **fix(installer): recognize quoted Codex MCP keys** (#4469)
- **fix(hud): report cached HUD load failures** (#4468)
- **fix(skills): align argument hints with behavior** (#4465)
- **fix(team): validate shutdown acknowledgements before consuming them** (#4462)
- **fix(ultragoal): allow plugin-only bootstrap commands** (#4459)

### Other Changes

- **test(ci): make timing regression tests deterministic** (#4464)
- **ci: canonicalize generated-artifact authorization expiry timestamps** (#4484)
- **ci: sync the v5.7.6 main release back into dev** (#4485)
- **chore(inventory): regenerate the inventory graph** (#4486)

---

# oh-my-claudecode v5.7.6: Fix plugin-mode HUD loading and tighten input validation

## Release Notes

Hotfix for v5.7.5: the plugin HUD no longer imports Zod from the plugin cache, where `node_modules` is unavailable. This release also fixes HUD estimates, frontmatter handling, command parsing, and numeric option validation.

### Bug Fixes

- **fix(hud): remove the runtime Zod dependency from plugin security config** (#4454, PR #4455)
- **fix(hud): exclude local API request records from the payload estimate** (#4437)
- **fix(featured-contributors): reject invalid `--min-stars` values** (#4439)
- **fix(session-end): prevent `OMC_DAILY_CHAIN_LIMIT` from flooring to zero** (#4440)
- **fix(autoresearch): reject invalid `--max-waves` and `--poll-interval` values** (#4441)
- **fix(team): reject non-integer numeric CLI flag values** (#4442)
- **fix(auto-slash-command): keep the plugin namespace when parsing slash commands** (#4450)
- **fix(agents): read frontmatter by line-anchored delimiters, including after a BOM** (#4451)
- **fix(autoresearch): accept a leading UTF-8 BOM in `sandbox.md` frontmatter** (#4452)

### Other Changes

- **ci:** refresh generated-artifact authorizations and inventory metadata for the main-to-dev sync (#4444, #4445, #4449, #4453)

---
