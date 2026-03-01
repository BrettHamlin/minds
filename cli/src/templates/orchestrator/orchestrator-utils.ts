#!/usr/bin/env bun

/**
 * orchestrator-utils.ts - Shared utilities for orchestrator scripts
 *
 * Re-exports from src/lib/pipeline/utils for backward compatibility.
 * All orchestrator scripts import from here; tests import from here.
 */

export { getRepoRoot, readJsonFile, writeJsonAtomic, getRegistryPath } from "../../lib/pipeline/utils";
