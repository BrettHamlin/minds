# Drone Brief: @transport for BRE-446 (Wave 2)

## Tasks assigned to you

- [ ] T009 @transport Update minds/lib/drone-pane.ts to accept --bus-url flag and inject BUS_URL env var into the Claude Code spawn command using injectBusEnv from minds/transport/minds-bus-lifecycle.ts
- [ ] T010 @transport Update minds/dispatch.ts to:
  a) Remove bus lifecycle management from dispatchWave() — no more startMindsBus/teardownMindsBus calls inside dispatchWave. The caller handles bus lifecycle externally.
  b) dispatchWave should require busUrl in options when bus transport is desired (keep backward compat: if no busUrl, tmux fallback still works)
  c) dispatchToMind should pass busUrl to drone-pane.ts via --bus-url flag (instead of publishing DRONE_SPAWNED directly). The drone-pane.ts now injects BUS_URL into the drone's env.
  d) Keep the DRONE_SPAWNED bus publish in dispatchToMind as a notification (it's useful for monitoring), but move the brief delivery back to tmux-send for all cases (bus or not). The bus carries signals, tmux carries brief text.

## Key context

- injectBusEnv() is already exported from minds/transport/minds-bus-lifecycle.ts (you built it in Wave 1)
- drone-pane.ts currently launches Claude with: `'cd ${worktreePath} && claude --dangerously-skip-permissions --model sonnet' Enter`
- With --bus-url, it should become: `'cd ${worktreePath} && BUS_URL=${busUrl} claude --dangerously-skip-permissions --model sonnet' Enter`
- dispatch.ts currently calls dev-pane.ts (the generic one). It should call drone-pane.ts instead (minds/lib/drone-pane.ts) with --mind and --ticket flags
- The startMindsBus/teardownMindsBus imports can stay in dispatch.ts but dispatchWave should NOT call them. Remove the lifecycle management from dispatchWave's try/finally block.

## Files to modify

- minds/lib/drone-pane.ts — add --bus-url flag, inject into spawn command
- minds/dispatch.ts — refactor dispatchWave, update dispatchToMind to use drone-pane.ts
- minds/dispatch.test.ts — update tests to reflect the changes

## Acceptance criteria

- drone-pane.ts accepts --bus-url and injects BUS_URL env var
- dispatchWave no longer calls startMindsBus/teardownMindsBus
- dispatchToMind uses drone-pane.ts (not dev-pane.ts)
- All existing tests pass (update mocks as needed)
- bun test minds/ passes

## When done

Do NOT commit. Type: DRONE_COMPLETE @transport BRE-446 Wave 2
