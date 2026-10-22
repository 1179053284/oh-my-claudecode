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
- **fix(version): rank prereleases below their corresponding stable release** (#4511)

### Other Changes

- **test(ci): make SessionStart timing tests deterministic** (#4514)
- **ci:** canonicalize generated-artifact authorization timestamps and refresh authorization entries for release and sync PRs (#4480, #4504, #4507, #4509)
- **chore(inventory): rebuild generated artifacts and inventory during the v5.7.7 main-to-dev sync** (#4506)

### Install / Update

The npm CLI and the Claude Code marketplace/plugin are separate install tracks, not either/or replacements. Update whichever track you use; if you have both installed, update both. CLI-dependent skill paths such as `ask` and CLI-backed `team` require the `omc` CLI from the npm package.

**CLI / runtime:**

```bash
npm install -g oh-my-claude-sisyphus@5.7.8
```

**Claude Code plugin:**

```text
/plugin marketplace update omc
```

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-claudecode/compare/v5.7.7...v5.7.8

## Contributors

Thank you to all contributors who made this release possible!

@rudycelekli
