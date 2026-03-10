# BRE-482 Contract Test Checklist

- [ ] 1. **Verify clean state** — no BRE-482 branches, worktrees, directories, processes, or state files
- [ ] 2. **Verify code changes** — `minds/lib/mind-pane.ts` has contract check, `minds/lib/check-contracts.ts` exists, drone is `model: sonnet`
- [ ] 3. **Open new tmux window** — `tmux new-window -n "BRE-482-run" -c /Users/atlas/Code/projects/gravitas`
- [ ] 4. **Launch Claude Code** — `tmux send-keys -t "BRE-482-run" "claude --dangerously-skip-permissions" Enter`
- [ ] 5. **Send implement command** — wait for ready, then `tmux send-keys -t "BRE-482-run" "/minds.implement BRE-482" Enter`
- [ ] 6. **Launch injection watcher** — background agent runs `bash /tmp/inject-violation.sh`
- [ ] 7. **Hands off** — wait for agent notification, no polling
- [ ] 8. **Check results** — git log to verify Mind caught violation, drone fixed it, merges succeeded
