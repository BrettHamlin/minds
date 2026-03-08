# Drone Brief: @templates for BRE-442 (resolve-feature fix)

Mind pane ID: %31299

## Problem

`minds/templates/scripts/resolve-feature.ts` is installed to target repos at `.collab/scripts/resolve-feature.ts`. It imports from `../lib/pipeline/` (the `.collab/` structure). The source version at `minds/execution/resolve-feature.ts` imports from `../pipeline_core/` (the Mind structure).

A bug fix was applied to `minds/execution/resolve-feature.ts` — positional ticket ID support so it works on `main` branch. That fix needs to be ported to `minds/templates/scripts/resolve-feature.ts` with the correct import paths.

## Task

- [ ] F001 @templates Port the positional ticket ID fix from `minds/execution/resolve-feature.ts` to `minds/templates/scripts/resolve-feature.ts`. The fix adds: (1) parsing a positional arg matching `/^[A-Z]+-\d+$/`, (2) allowing non-feature branches when a ticket ID is provided, (3) auto-creating `specs/{TICKET_ID}/` when it doesn't exist, (4) falling back to the positional arg for ticketId output. Keep the existing import paths (`../lib/pipeline/`) — do NOT change them to Mind-relative paths.

## Constraints

- Only modify `minds/templates/scripts/resolve-feature.ts`
- Read `minds/execution/resolve-feature.ts` to see the fix, then apply the same logic
- Do NOT commit

## Done signal

```bash
bun minds/lib/tmux-send.ts %31299 "DRONE_COMPLETE @templates BRE-442"
```
