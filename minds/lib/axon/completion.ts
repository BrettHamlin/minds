/**
 * completion.ts -- Event-based process completion detection via Axon EventBus.
 *
 * Subscribes to Axon events for a specific process and waits for an Exited
 * event, providing a clean alternative to sentinel-file polling.
 */

import type { AxonClient } from "./client.ts";

export interface CompletionResult {
  ok: boolean;
  exitCode?: number;
  error?: string;
}

/** Sentinel symbol used to identify timeout results in Promise.race. */
const TIMEOUT_SENTINEL = Symbol("timeout");

/**
 * Wait for a process to complete using Axon event subscription.
 *
 * Subscribes to events for the given processId, reads events in a loop,
 * and resolves when an Exited event arrives for the target process.
 *
 * @param client - Connected AxonClient instance
 * @param processId - The process ID to watch for completion
 * @param timeoutMs - Optional timeout in milliseconds (default: no timeout)
 * @returns CompletionResult with ok=true if exitCode is 0
 */
export async function waitForProcessCompletion(
  client: AxonClient,
  processId: string,
  timeoutMs?: number,
): Promise<CompletionResult> {
  const sub = await client.subscribe({ process_ids: [processId as any] });
  let timedOut = false;

  try {
    // Build a timeout promise if needed
    let timeoutReject: (() => void) | undefined;
    const timeoutPromise =
      timeoutMs !== undefined
        ? new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
            const timer = setTimeout(() => {
              timedOut = true;
              resolve(TIMEOUT_SENTINEL);
            }, timeoutMs);
            timeoutReject = () => clearTimeout(timer);
          })
        : null;

    while (true) {
      // Race readEvent against the timeout
      const eventPromise = client.readEvent();
      const result = timeoutPromise
        ? await Promise.race([eventPromise, timeoutPromise])
        : await eventPromise;

      if (result === TIMEOUT_SENTINEL) {
        return { ok: false, error: "timeout" };
      }

      const { event } = result as Awaited<ReturnType<typeof client.readEvent>>;

      if (event.t === "Exited" && event.c.process_id === processId) {
        // Cancel the timeout since we got our result
        timeoutReject?.();
        const exitCode =
          event.c.exit_code !== null ? event.c.exit_code : undefined;
        return { ok: exitCode === 0, exitCode };
      }
      // Not our target event -- continue reading
    }
  } finally {
    if (!timedOut) {
      try {
        await client.unsubscribe(sub.id);
      } catch {
        // Best-effort unsubscribe; connection may already be closed
      }
    }
  }
}
