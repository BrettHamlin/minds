/**
 * engine.ts — Lazy accessor for the SpecEngine child Mind.
 *
 * Set once at startup (by index.ts or server.ts), then used by route handlers.
 * Routes call engine().handle(request, context) instead of importing services directly.
 */

import type { ChildProcess } from "../discovery.js";
import type { WorkResult } from "../mind.js";
import { AppError } from "../shared/errors.js";

let _engine: ChildProcess | null = null;

export function setEngine(child: ChildProcess): void {
  _engine = child;
}

export function getEngine(): ChildProcess {
  if (!_engine) throw new Error("SpecEngine child not initialized — call setEngine() at startup");
  return _engine;
}

/** Unwrap a WorkResult from SpecEngine, re-throwing AppErrors with correct HTTP codes. */
export function unwrap<T>(result: unknown): T {
  const r = result as { status: string; data?: unknown; error?: string };
  if (r.error) {
    const data = r.data as { errorCode?: string; statusCode?: number } | undefined;
    const code = data?.errorCode ?? "INTERNAL_ERROR";
    const statusCode = data?.statusCode ?? 500;
    throw new AppError(code, statusCode, r.error);
  }
  return r.data as T;
}

/** Call SpecEngine and unwrap result in one step. */
export async function callEngine<T>(request: string, context?: unknown): Promise<T> {
  const result = await getEngine().handle(request, context) as WorkResult;
  return unwrap<T>(result);
}
