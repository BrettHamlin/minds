# Scaffold Workflow

## Trigger

User has already reviewed a Fission analysis and wants to scaffold the Minds.

## Steps

### 1. Locate Analysis

Check if a previous Fission analysis JSON exists:
- Look for an `--output` file the user previously saved
- Or re-run the pipeline if no saved analysis exists

### 2. Confirm Mind Map

Display the Mind map from the saved analysis and confirm with the user:
- Show each Mind name, file count, and primary directories
- Show the Foundation Mind and its hub files
- Ask the user to confirm before proceeding

### 3. Scaffold

Run scaffolding for each Mind in the approved map:

```bash
bun minds/cli/bin/minds.ts fission <target-dir> --yes --offline
```

### 4. Post-Scaffold

- Verify all Mind directories were created
- Show the updated minds.json
- Remind user to customize each MIND.md with domain-specific conventions
