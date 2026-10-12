# oh-my-claudecode v5.7.0: show Claude Code, tighten skill prose, rename shipyard glossary

## Release Notes

Release with **4 new features**, **45 bug fixes**, **9 other changes** across **59 merged PRs**.

### Highlights

- **feat(hud): show Claude Code effort level** (#4249) — thanks @bengry
- **feat(skills): tighten skill prose and prompt guardrails** (#4271) — thanks @pangpang778
- **feat: rename shipyard glossary slot CONTEXT.md to GLOSSARY.md** (#4273) — thanks @pangpang778
- **feat(skills): add session flow map** (#4319)

### New Features

- **feat(hud): show Claude Code effort level** (#4249) — thanks @bengry
- **feat(skills): tighten skill prose and prompt guardrails** (#4271) — thanks @pangpang778
- **feat: rename shipyard glossary slot CONTEXT.md to GLOSSARY.md** (#4273) — thanks @pangpang778
- **feat(skills): add session flow map** (#4319)

### Bug Fixes

- **fix(hud): render todos from TaskCreate/TaskUpdate** (#4243)
- **fix(hooks): clear autopilot state armed from sanitized pasted-echo prompt** (#4251)
- **fix(worktree-paths): accept Windows session cwd in a repo subdirectory** (#4255)
- **fix(antigravity): allow Windows headless and pass prompt as single argv** (#4259)
- **fix(ci): drop generated build artifacts committed by #4259** (#4260)
- **fix(cache): prevent orphaned version directories from being selected** (#4265)
- **fix: remove /tmp/omc-jev-* temp directories after use** (#4268)
- **fix(team): stabilize Cursor lifecycle and centralized state resolution** (#4272) — thanks @iyoda
- **fix(permission-handler): validate git heredoc commands** (#4280)
- **fix(omc-doctor): preserve custom hooks in settings** (#4281)
- **fix: make user settings opt-in for AFK links** (#4282)
- **fix: avoid persisting tool failure secrets** (#4284)
- **fix: preserve JSONC comment token boundaries** (#4285) — thanks @rudycelekli
- **fix: reject payloads without a JSON representation** (#4286) — thanks @rudycelekli
- **fix: measure ANSI CSI controls with private and colon parameters** (#4287) — thanks @rudycelekli
- **fix: reject complete IPv6 local ranges in SSRF guard** (#4288) — thanks @rudycelekli
- **fix: preserve custom notes with colliding delimiter text** (#4289) — thanks @rudycelekli
- **fix: pass literal git tag arguments without shell expansion** (#4290) — thanks @rudycelekli
- **fix: match exact Azure DevOps host identities** (#4291) — thanks @rudycelekli
- **fix: keep transcript context usage within a complete frame** (#4292) — thanks @rudycelekli
- **fix: skip incomplete version-manager Node installations** (#4293) — thanks @rudycelekli
- **fix(notifications): escape values in JSON webhook templates** (#4295) — thanks @rudycelekli
- **fix(providers): resolve cwd before caching Git remotes** (#4296) — thanks @rudycelekli
- **fix(mcp): avoid false Codex registry mismatch for type fields** (#4297)
- **fix(cache): preserve versions when active redirect targets are unusable** (#4298) — thanks @rudycelekli
- **fix(cache): fail closed when occupancy records cannot be read** (#4299) — thanks @rudycelekli
- **fix(notifications): ignore inherited template variable properties** (#4300) — thanks @rudycelekli
- **fix(notifications): validate custom integration configuration shapes** (#4301) — thanks @rudycelekli
- **fix(hud): drain custom rate provider diagnostic stderr** (#4302) — thanks @rudycelekli
- **fix(hud): cap completed task history while preserving active tasks** (#4303) — thanks @rudycelekli
- **fix(hud): key custom provider cache by command and periods** (#4304) — thanks @rudycelekli
- **fix(hud): encode directory hyperlinks and escape filename controls** (#4305) — thanks @rudycelekli
- **fix(hud): use visible text for ANSI truncation and slicing** (#4306) — thanks @rudycelekli
- **fix(cli): escape transcript controls in session search terminal output** (#4307) — thanks @rudycelekli
- **fix(notifications): normalize carriage returns before reply injection** (#4308) — thanks @rudycelekli
- **fix: fail directory diagnostics on compiler invocation errors** (#4309) — thanks @rudycelekli
- **fix: count Unicode characters in team usage records** (#4310) — thanks @rudycelekli
- **fix(notifications): honor ports in Telegram proxy exclusions** (#4311) — thanks @rudycelekli
- **fix(notifications): preserve whitespace in tmux session names** (#4312) — thanks @rudycelekli
- **fix: resolve local LSP file URIs with native paths** (#4313) — thanks @rudycelekli
- **fix(notifications): atomically rewrite the reply registry** (#4314) — thanks @rudycelekli
- **fix: skip invalid team usage log records** (#4315) — thanks @rudycelekli
- **fix: resume panes only after confirmed quota recovery** (#4316) — thanks @rudycelekli
- **fix(jev): harden sweep ownership and hourly locking** (#4320)
- **fix: bound PostToolUseFailure lock work** (#4322)

### Refactoring

- **refactor(shipyard): slim chain artifacts to tracker issues and lazy surfaces** (#4274) — thanks @pangpang778

### Other Changes

- **Fix #4244: wiki-session-end imports a lean foreground bootstrap so the SessionEnd hook stays inside the 300 ms budget** (#4246) — thanks @RobinNorberg
- **Fix #4245: team shutdown keeps the active reservation when the start CLI has exited** (#4247) — thanks @RobinNorberg
- **Fix #4252: detached omc team session creation fails because the -F format is #-escaped** (#4253) — thanks @smpark00
- **Fix #4256: enforce ralph hardMaxIterations in the Stop hook scripts** (#4257) — thanks @smpark00
- **Fix #4261: cmux team ownership verification with tmux-compat and ref/UUID mismatch** (#4262)
- **Fix #4267: Generate shell-appropriate tmux guard conditions for native Windows** (#4269)
- **Fix #4276: restrict permission auto-approval** (#4283)
- **Fix keyword detection in attributed paste blocks** (#4318)
- **test: cover stale PostToolUseFailure fallback locks** (#4324)

### Stats

- **59 PRs merged** | **4 new features** | **45 bug fixes** | **0 security/hardening improvements** | **9 other changes**

### External Contributors

- @bengry: #4249
- @iyoda: #4272
- @pangpang778: #4271, #4273, #4274
- @RobinNorberg: #4246, #4247
- @rudycelekli: #4285, #4286, #4287, #4288, #4289, #4290, #4291, #4292, #4293, #4295, #4296, #4298, #4299, #4300, #4301, #4302, #4303, #4304, #4305, #4306, #4307, #4308, #4309, #4310, #4311, #4312, #4313, #4314, #4315, #4316
- @smpark00: #4253, #4257
