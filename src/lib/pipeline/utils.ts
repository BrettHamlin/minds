/**
 * utils.ts — Re-export barrel. All implementations live in minds/pipeline_core/.
 *
 * This file exists only for backward compatibility during the WD migration.
 * Import directly from minds/pipeline_core/{module} for new code.
 */

export { getRepoRoot } from "../../../minds/pipeline_core/repo";
export { readJsonFile, writeJsonAtomic } from "../../../minds/pipeline_core/json-io";
export { validateTicketIdArg } from "../../../minds/pipeline_core/validation";
export type { FeatureMetadata } from "../../../minds/pipeline_core/feature";
export {
  normalizeMetadata,
  readFeatureMetadata,
  readMetadataJson,
  scanFeaturesMetadata,
  findFeatureDir,
} from "../../../minds/pipeline_core/feature";
export type { LoadedPipeline } from "../../../minds/pipeline_core/pipeline";
export {
  parsePipelineArgs,
  resolvePipelineConfigPath,
  loadPipelineForTicket,
} from "../../../minds/pipeline_core/pipeline";
