# oh-my-claudecode v5.7.10: Fail-closed Ralph PRD verification

## Release Notes

This release makes `omc ralph verify` fail closed when an existing PRD is invalid or unreadable, instead of incorrectly reporting that no feedback commands exist. Thanks to Get-bot for reporting #4526.

### Bug Fixes

- **fix(ralph): fail closed for invalid PRDs** (#4527, fixes #4526; reported by Get-bot)

### Other Changes

- **chore(sync): merge the v5.7.9 main release into dev** (#4524)
- **ci: authorize generated artifacts for sync PR #4524** (#4525)

### Install / Update

The npm CLI and the Claude Code marketplace/plugin are separate install tracks, not either/or replacements. Update whichever track you use; if you have both installed, update both. CLI-dependent skill paths such as `ask` and CLI-backed `team` require the `omc` CLI from the npm package.

**CLI / runtime:**

```bash
npm install -g oh-my-claude-sisyphus@5.7.10
```

**Claude Code plugin:**

```text
/plugin marketplace update omc
```

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-claudecode/compare/v5.7.9...v5.7.10

## Contributors

Thank you to all contributors who made this release possible!

@Yeachan-Heo
