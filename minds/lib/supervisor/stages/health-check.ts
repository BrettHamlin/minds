/**
 * health-check.ts — Stage executor for HTTP endpoint validation with retries.
 *
 * Used by BUILD_PIPELINE and TEST_PIPELINE stages to verify that a service
 * is healthy before proceeding to subsequent stages.
 *
 * Configuration:
 *   stage.config.url            — URL to check (string, required).
 *   stage.config.expectedStatus — Expected HTTP status code (number, default 200).
 *   stage.config.retries        — Max retry attempts (number, default 3).
 *   stage.config.retryDelayMs   — Delay between retries in ms (number, default 2000).
 *
 * Stores:
 *   ctx.store.healthCheckResult — Object with { ok, status, attempts }.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

const DEFAULT_EXPECTED_STATUS = 200;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

export const executeHealthCheck = async (
  stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const url = stage.config?.url as string | undefined;

  if (!url) {
    return {
      ok: false,
      error: "No url configured: set stage.config.url",
    };
  }

  const expectedStatus =
    (stage.config?.expectedStatus as number | undefined) ?? DEFAULT_EXPECTED_STATUS;
  const maxRetries =
    (stage.config?.retries as number | undefined) ?? DEFAULT_RETRIES;
  const retryDelayMs =
    (stage.config?.retryDelayMs as number | undefined) ?? DEFAULT_RETRY_DELAY_MS;

  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      lastStatus = response.status;

      if (response.status === expectedStatus) {
        ctx.store.healthCheckResult = {
          ok: true,
          status: response.status,
          attempts: attempt,
        };
        return { ok: true };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    // Wait before retrying (except on last attempt)
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  ctx.store.healthCheckResult = {
    ok: false,
    status: lastStatus,
    attempts: maxRetries,
  };

  const detail = lastError
    ? `fetch error: ${lastError}`
    : `got status ${lastStatus}, expected ${expectedStatus}`;

  return {
    ok: false,
    error: `Health check failed after ${maxRetries} attempts: ${url} (${detail})`,
  };
};
