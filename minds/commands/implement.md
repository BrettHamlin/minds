---
description: Run the Minds implement CLI to dispatch drones for a ticket.
---

> **IMPORTANT:** This is a MINIMAL depth command. Do NOT run the PAI Algorithm. Do NOT run OBSERVE/THINK/PLAN/BUILD/EXECUTE/VERIFY/LEARN phases. Do NOT create ISC criteria. Just run the command and report the output.

Run this command, wait for it to finish, and report the result:

```bash
if [ -f .minds/cli/bin/minds.ts ]; then
  bun .minds/cli/bin/minds.ts implement $ARGUMENTS
else
  bun minds/cli/bin/minds.ts implement $ARGUMENTS
fi
```

When the command completes, report whether it succeeded or failed. That's it. Nothing else.
