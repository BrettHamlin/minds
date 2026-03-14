/**
 * completion.ts -- Event-based process completion detection via Axon EventBus.
 *
 * Subscribes to Axon events for a specific process and waits for an Exited
 * event, providing a clean alternative to sentinel-file polling.
 */

import type { AxonClient } from "./client.ts";
import { validateProcessId } from "./types.ts";

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
 * **Timeout behavior:** After a timeout, a dangling `readEvent()` promise may
 * still be pending on the client. Callers should close the client after a
 * timeout rather than reusing it, as the pending read may consume the next
 * message from the server and leave the client in an indeterminate state.
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
  const validatedId = validateProcessId(processId);
  const sub = await client.subscribe({ process_ids: [validatedId] });

  // Guard against subscribe-after-exit race: if the process already exited
  // before we subscribed, the Exited event was dispatched and will never arrive.
  try {
    const info = await client.info(processId);
    if (typeof info.state === "object" && "Exited" in info.state) {
      const exitCode = info.state.Exited.exit_code ?? undefined;
      try {
        await client.unsubscribe(sub.id);
      } catch {
        // Best-effort cleanup
      }
      return { ok: exitCode === 0, exitCode };
    }
  } catch {
    // Process not found -- treat as already exited with unknown code
    try {
      await client.unsubscribe(sub.id);
    } catch {
      // Best-effort cleanup
    }
    return { ok: false, error: "process_not_found" };
  }

  try {
    // Build a timeout promise if needed
    let timeoutReject: (() => void) | undefined;
    const timeoutPromise =
      timeoutMs !== undefined
        ? new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
            const timer = setTimeout(() => {
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
    try {
      // Use a short timeout to avoid hanging if a dangling readEvent()
      // promise is consuming responses (common after timeout).
      await Promise.race([
        client.unsubscribe(sub.id),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("unsubscribe timeout")), 1000),
        ),
      ]);
    } catch {
      // Best-effort unsubscribe; connection may already be closed or
      // a dangling readEvent may prevent us from getting the response.
    }
  }
}
