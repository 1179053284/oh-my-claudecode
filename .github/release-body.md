# oh-my-claudecode v5.7.1: Bug Fixes

## Release Notes

Release with **3 bug fixes**, **1 other change** across **4 merged PRs**.

### Highlights

- **fix(lsp_diagnostics_directory): resolve local tsc binary for Windows .cmd shim support** (#4332)
- **fix(team): remove committed artifact and add env file cleanup test (#4330 follow-up)** (#4334)
- **fix(team): clean up env file when guarded split execution fails (#4330)** (#4330)

### Bug Fixes

- **fix(lsp_diagnostics_directory): resolve local tsc binary for Windows .cmd shim support** (#4332)
- **fix(team): remove committed artifact and add env file cleanup test (#4330 follow-up)** (#4334)
- **fix(team): clean up env file when guarded split execution fails (#4330)** (#4330)

### Other Changes

- **ci: authorize generated artifacts for v5.7.0 back-merge (PR #4328)**

### Stats

- **4 PRs merged** | **0 new features** | **3 bug fixes** | **0 security/hardening improvements** | **1 other change**

### Install / Update

The npm CLI and the Claude Code marketplace/plugin are separate install tracks, not either/or replacements. Update whichever track you use; if you have both installed, update both. CLI-dependent skill paths such as `ask` and CLI-backed `team` require the `omc` CLI from the npm package.

**CLI / runtime:**

```bash
npm install -g oh-my-claude-sisyphus@5.7.1
```

**Claude Code plugin:**

```text
/plugin marketplace update omc
```

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-claudecode/compare/v5.7.0...v5.7.1
