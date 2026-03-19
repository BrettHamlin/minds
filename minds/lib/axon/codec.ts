/**
 * codec.ts -- Line-delimited JSON codec for Node.js streams.
 *
 * Handles buffering, line splitting, JSON parsing, empty line skipping,
 * and max line length enforcement. Works with any Duplex stream
 * (including net.Socket).
 */

import type { Duplex } from "node:stream";

/** Maximum allowed line length (1 MiB). */
const MAX_LINE_LENGTH = 1024 * 1024;

/** Queued result: either a line or an error. */
type QueuedResult =
  | { ok: true; line: string }
  | { ok: false; error: Error };

/** A pending reader waiting for data. */
interface PendingReader {
  resolve: (line: string) => void;
  reject: (err: Error) => void;
}

/**
 * Line-delimited JSON codec wrapping a Node.js Duplex stream.
 *
 * Reads incoming data, buffers partial lines, splits on `\n`,
 * and parses each complete line as JSON. Writes serialize objects
 * to JSON + `\n`.
 */
export class LineCodec {
  private stream: Duplex;
  private buffer = "";
  private queue: QueuedResult[] = [];
  private pendingReaders: PendingReader[] = [];
  private ended = false;
  private error: Error | null = null;

  constructor(stream: Duplex) {
    this.stream = stream;

    this.stream.on("data", (chunk: Buffer | string) => {
      this.onData(typeof chunk === "string" ? chunk : chunk.toString());
    });

    this.stream.on("end", () => {
      this.ended = true;
      this.deliver({ ok: false, error: new Error("EOF") });
    });

    this.stream.on("error", (err: Error) => {
      this.error = err;
      this.deliver({ ok: false, error: err });
    });
  }

  /** Deliver a result to a waiting consumer, or queue it. */
  private deliver(result: QueuedResult): void {
    if (this.pendingReaders.length > 0) {
      const reader = this.pendingReaders.shift()!;
      if (result.ok) {
        reader.resolve(result.line);
      } else {
        reader.reject(result.error);
      }
    } else {
      this.queue.push(result);
    }
  }

  private onData(data: string): void {
    this.buffer += data;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      const trimmed = line.trim();
      if (!trimmed) continue;

      if (Buffer.byteLength(trimmed) > MAX_LINE_LENGTH) {
        this.deliver({
          ok: false,
          error: new Error(`line exceeds maximum length of ${MAX_LINE_LENGTH} bytes`),
        });
        continue;
      }

      this.deliver({ ok: true, line: trimmed });
    }

    // Check if remaining buffer (without newline yet) exceeds max
    if (Buffer.byteLength(this.buffer) > MAX_LINE_LENGTH) {
      this.buffer = "";
      this.deliver({
        ok: false,
        error: new Error(`line exceeds maximum length of ${MAX_LINE_LENGTH} bytes`),
      });
    }
  }

  /**
   * Wait for and return the next complete line from the stream.
   * Skips empty lines. Rejects on EOF or stream error.
   */
  private nextLine(): Promise<string> {
    // Check queued results
    if (this.queue.length > 0) {
      const result = this.queue.shift()!;
      if (result.ok) return Promise.resolve(result.line);
      return Promise.reject(result.error);
    }

    // Already ended or errored
    if (this.ended) {
      return Promise.reject(new Error("EOF"));
    }
    if (this.error) {
      return Promise.reject(this.error);
    }

    // Wait for next result -- enqueue this reader in FIFO order
    return new Promise<string>((resolve, reject) => {
      this.pendingReaders.push({ resolve, reject });
    });
  }

  /**
   * Read and parse the next JSON message from the stream.
   * Skips empty lines. Rejects on EOF, stream error, or malformed JSON.
   */
  async readMessage<T = unknown>(): Promise<T> {
    const line = await this.nextLine();
    try {
      return JSON.parse(line) as T;
    } catch (e) {
      throw new Error(
        `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Serialize a message to JSON + newline and write to the stream.
   */
  writeMessage(msg: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const json = JSON.stringify(msg) + "\n";
      this.stream.write(json, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Destroy the underlying stream.
   */
  destroy(): void {
    this.stream.destroy();
  }
}
