# oh-my-claudecode v5.7.9: Safer Windows startup, Codex TOML output, and aligned Jev timeouts

## Release Notes

This release fixes Windows startup trust-prompt handling, escaping unpaired surrogates in Codex MCP TOML output, and aligning Jev active parent timeouts with resolver behavior. Thanks to @rudycelekli and @alw51307 for their contributions.

### Bug Fixes

- **fix(team): guard Windows startup trust prompts** (#4502)
- **fix(mcp-registry): escape unpaired surrogates in Codex TOML output** (#4512, @rudycelekli)
- **fix(jev): align active parent timeout with resolver** (#4515, @alw51307)

### Other Changes

- **chore(sync): merge v5.7.8 main release into dev and rebuild the inventory** (#4519)
- **ci: authorize generated artifacts for the v5.7.8 main-to-dev sync** (#4520)

### Install / Update

The npm CLI and the Claude Code marketplace/plugin are separate install tracks, not either/or replacements. Update whichever track you use; if you have both installed, update both. CLI-dependent skill paths such as `ask` and CLI-backed `team` require the `omc` CLI from the npm package.

**CLI / runtime:**

```bash
npm install -g oh-my-claude-sisyphus@5.7.9
```

**Claude Code plugin:**

```text
/plugin marketplace update omc
```

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-claudecode/compare/v5.7.8...v5.7.9

## Contributors

Thank you to all contributors who made this release possible!

@rudycelekli @alw51307
