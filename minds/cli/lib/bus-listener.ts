/**
 * bus-listener.ts -- SSE listener that subscribes to the bus and waits
 * for MIND_COMPLETE events from all expected minds in a wave.
 *
 * Uses fetch() SSE to connect to the bus server's /subscribe/:channel
 * endpoint. Parses `data:` lines as JSON and looks for events with
 * type "MIND_COMPLETE" matching the expected waveId and mindNames.
 */

import { MindsEventType } from "../../transport/minds-events.ts";

export interface WaveCompletionResult {
  ok: boolean;
  completed: string[]; // mind names that reported complete
  missing: string[]; // mind names that did not report
  errors: string[];
}

/**
 * Subscribe to the bus and wait for MIND_COMPLETE from all expected minds.
 *
 * @param busUrl    - Base URL of the bus server (e.g. "http://localhost:7777")
 * @param channel   - Channel to subscribe to (e.g. "minds-BRE-123")
 * @param waveId    - Wave ID to match (e.g. "wave-1")
 * @param expectedMinds - Mind names expected to complete
 * @param timeoutMs - Maximum time to wait (default: 30 minutes)
 * @param signal    - AbortSignal for external cancellation
 */
export async function waitForWaveCompletion(
  busUrl: string,
  channel: string,
  waveId: string,
  expectedMinds: string[],
  timeoutMs: number = 30 * 60 * 1000,
  signal?: AbortSignal,
  onDroneComplete?: (mindName: string) => void,
): Promise<WaveCompletionResult> {
  const completed = new Set<string>();
  const errors: string[] = [];
  const expected = new Set(expectedMinds);

  return new Promise<WaveCompletionResult>(async (resolve) => {
    const timeout = setTimeout(() => {
      const missing = [...expected].filter((m) => !completed.has(m));
      resolve({
        ok: false,
        completed: [...completed],
        missing,
        errors: [
          ...errors,
          `Timeout after ${timeoutMs}ms. Missing: ${missing.join(", ")}`,
        ],
      });
    }, timeoutMs);

    const abortHandler = () => {
      clearTimeout(timeout);
      const missing = [...expected].filter((m) => !completed.has(m));
      resolve({
        ok: false,
        completed: [...completed],
        missing,
        errors: [...errors, "Aborted by signal"],
      });
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      const url = `${busUrl}/subscribe/${channel}`;
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

      const response = await fetch(url, { signal: fetchSignal });

      if (!response.ok) {
        clearTimeout(timeout);
        resolve({
          ok: false,
          completed: [...completed],
          missing: [...expected],
          errors: [`Bus subscribe failed: HTTP ${response.status}`],
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        clearTimeout(timeout);
        resolve({
          ok: false,
          completed: [...completed],
          missing: [...expected],
          errors: ["No response body from bus subscribe"],
        });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice("data:".length).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (
              event.type === MindsEventType.MIND_COMPLETE &&
              event.payload?.waveId === waveId &&
              event.payload?.mindName &&
              expected.has(event.payload.mindName)
            ) {
              completed.add(event.payload.mindName);
              console.log(
                `  MIND_COMPLETE: @${event.payload.mindName} (${completed.size}/${expected.size})`,
              );
              onDroneComplete?.(event.payload.mindName);

              if (completed.size === expected.size) {
                clearTimeout(timeout);
                reader.cancel();
                resolve({
                  ok: true,
                  completed: [...completed],
                  missing: [],
                  errors,
                });
                return;
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) return; // Already handled by abortHandler
      clearTimeout(timeout);
      const missing = [...expected].filter((m) => !completed.has(m));
      resolve({
        ok: false,
        completed: [...completed],
        missing,
        errors: [...errors, `SSE connection error: ${err}`],
      });
    }
  });
}
