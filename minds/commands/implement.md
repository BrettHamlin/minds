---
description: Run the Minds implement CLI to dispatch drones for a ticket.
---

> **IMPORTANT:** Do NOT wrap this in PAI Algorithm phases. Do NOT invent steps. Run the single command below exactly ONCE.

Detect which path exists and run it:

```bash
if [ -f .minds/cli/bin/minds.ts ]; then
  bun .minds/cli/bin/minds.ts implement $ARGUMENTS
else
  bun minds/cli/bin/minds.ts implement $ARGUMENTS
fi
```

**After the command finishes, report the output and STOP.** Do NOT retry, re-run, or attempt to fix errors. If it fails, tell the user what went wrong and let them decide. Each run spawns tmux panes — retrying creates duplicate panes and orphaned processes.
