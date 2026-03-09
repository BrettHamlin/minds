---
description: iOS build phase — compile and install the app on simulator, emit BUILD_COMPLETE or BUILD_FAILED signal.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-237)

## Goal

Build and install the iOS app on the simulator for the given ticket. Write the build artifact metadata to `.gravitas/state/build-output-{ticket_id}.json` for the iosverify phase to consume. Emit a deterministic signal to the orchestrator.

## Execution Steps

### 1. Validate Input

Parse `ticket_id` from `$ARGUMENTS`. If missing, output "Usage: /gravitas.iosbuild <ticket-id>" and stop.

### 2. Verify Registry State

```bash
REGISTRY_PATH=$(bun .gravitas/scripts/orchestrator/resolve-path.ts ${ticket_id} registry)
test -f "$REGISTRY_PATH" || { echo "Not in orchestrated mode"; exit 1; }
```

Check current_step is "iosbuild":
```bash
cat "$REGISTRY_PATH" | grep '"current_step".*"iosbuild"' || echo "Warning: not in iosbuild phase"
```

### 3. Read Build Config from Spec

Read the spec file to find the iOS configuration:

```bash
cat specs/${ticket_id}/spec.md
```

Look for an `## iOS Config` section or YAML front matter with:
- `ios_repo_path` — absolute path to the iOS app repo (required)
- `ios_build_config` — build configuration name (optional, defaults to `"development"`)

**If `ios_repo_path` is not found in the spec:**

Emit clarification signal:
```bash
bun .gravitas/handlers/emit-build-signal.ts failed "ios_repo_path not found in spec. Add '## iOS Config' section with ios_repo_path to specs/${ticket_id}/spec.md"
```
Stop.

### 4. Run IosBuild Skill

Invoke the IosBuild Build workflow CLI:

```bash
bun ~/.claude/skills/IosBuild/Tools/Build.ts \
  --repo {ios_repo_path} \
  --config {ios_build_config}
```

Parse the JSON output. Capture:
- `result` — "success", "failed", or "needs_clarification"
- `simulator_udid`
- `bundle_id`
- `app_name`
- `build_config_used`
- `build_log`
- `reason` (present on failure)
- Full `evidence` array

### 5. Write Build Output Artifact

On success OR failure, always write the build output (orchestrator and iosverify read it):

```bash
mkdir -p .gravitas/state
cat > .gravitas/state/build-output-${ticket_id}.json << EOF
{
  "ticket_id": "${ticket_id}",
  "result": "${build_result}",
  "simulator_udid": "${simulator_udid}",
  "bundle_id": "${bundle_id}",
  "app_name": "${app_name}",
  "build_config_used": "${build_config_used}",
  "ios_repo_path": "${ios_repo_path}",
  "build_log": "${build_log}",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "evidence": ${evidence_json}
}
EOF
```

### 6. Emit Signal

**On success** (`result == "success"`):
```bash
bun .gravitas/handlers/emit-build-signal.ts complete "Build succeeded: ${app_name} installed on ${simulator_udid}"
```

**On failure** (`result == "failed"` or `"needs_clarification"`):
```bash
bun .gravitas/handlers/emit-build-signal.ts failed "${reason}"
```

## Signal Protocol

- **BUILD_COMPLETE** — App built and installed successfully. iosverify phase begins.
- **BUILD_FAILED** — Build or install failed. Orchestrator retries iosbuild (agent re-runs, may check KnownIssues and retry).

## Design Notes

- The build-output file is written in both success and failure cases so partial information is available for debugging.
- `ios_repo_path` and `ios_build_config` come from the spec — the spec is the source of truth for per-ticket iOS configuration.
- IosBuild skill handles all retry logic for known build issues internally. This command does not retry.
- Signals use the deterministic emission pattern: explicit Bash call, no hook dependency.
