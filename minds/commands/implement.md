---
description: Run the Minds implement CLI to dispatch drones for a ticket.
---

> **IMPORTANT:** Do NOT wrap this in PAI Algorithm phases. Do NOT invent steps. Run the single command below.

Detect which path exists and run it:

```bash
if [ -f .minds/cli/bin/minds.ts ]; then
  bun .minds/cli/bin/minds.ts implement $ARGUMENTS
else
  bun minds/cli/bin/minds.ts implement $ARGUMENTS
fi
```
