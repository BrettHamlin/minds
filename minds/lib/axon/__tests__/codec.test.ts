/**
 * codec.test.ts -- Tests for the line-delimited JSON codec.
 *
 * Uses mock Duplex streams to test line splitting, JSON parsing,
 * partial reads, and max line length enforcement.
 */

import { describe, test, expect } from "bun:test";
import { Duplex, PassThrough } from "node:stream";
import { LineCodec } from "../codec.ts";
import type { Message, MessageKind } from "../types.ts";

/**
 * Create a connected pair of PassThrough streams for testing.
 * Writing to writable feeds into the codec's readable side.
 */
function createMockStreams(): { writable: PassThrough; codec: LineCodec } {
  const stream = new PassThrough();
  const codec = new LineCodec(stream);
  return { writable: stream, codec };
}

describe("LineCodec", () => {
  describe("readMessage", () => {
    test("reads a complete JSON line", async () => {
      const { writable, codec } = createMockStreams();
      const msg = { id: 1, kind: { t: "List", c: null } };
      writable.write(JSON.stringify(msg) + "\n");

      const result = await codec.readMessage<Message>();
      expect(result).toEqual(msg);
    });

    test("handles data arriving in chunks", async () => {
      const { writable, codec } = createMockStreams();
      const msg = { id: 42, kind: { t: "Shutdown", c: null } };
      const json = JSON.stringify(msg);

      // Write in multiple chunks
      const mid = Math.floor(json.length / 2);
      writable.write(json.slice(0, mid));
      // Small delay to ensure chunking
      await new Promise((r) => setTimeout(r, 10));
      writable.write(json.slice(mid) + "\n");

      const result = await codec.readMessage<Message>();
      expect(result).toEqual(msg);
    });

    test("handles multiple messages in one chunk", async () => {
      const { writable, codec } = createMockStreams();
      const msg1 = { id: 1, kind: { t: "List", c: null } };
      const msg2 = { id: 2, kind: { t: "Shutdown", c: null } };

      writable.write(JSON.stringify(msg1) + "\n" + JSON.stringify(msg2) + "\n");

      const r1 = await codec.readMessage<Message>();
      const r2 = await codec.readMessage<Message>();
      expect(r1).toEqual(msg1);
      expect(r2).toEqual(msg2);
    });

    test("skips empty lines", async () => {
      const { writable, codec } = createMockStreams();
      const msg = { id: 1, kind: { t: "List", c: null } };

      writable.write("\n\n\n" + JSON.stringify(msg) + "\n");

      const result = await codec.readMessage<Message>();
      expect(result).toEqual(msg);
    });

    test("rejects lines exceeding max length", async () => {
      const { writable, codec } = createMockStreams();
      // Write a line that's over 1MB
      const longValue = "x".repeat(1024 * 1024 + 1);
      writable.write(`{"big":"${longValue}"}\n`);

      await expect(codec.readMessage()).rejects.toThrow(/exceeds maximum/);
    });

    test("returns error on EOF", async () => {
      const { writable, codec } = createMockStreams();
      writable.end();

      await expect(codec.readMessage()).rejects.toThrow(/EOF/);
    });

    test("returns error on malformed JSON", async () => {
      const { writable, codec } = createMockStreams();
      writable.write("not valid json\n");

      await expect(codec.readMessage()).rejects.toThrow();
    });
  });

  describe("writeMessage", () => {
    test("writes JSON followed by newline", async () => {
      const stream = new PassThrough();
      const codec = new LineCodec(stream);
      const msg = { id: 1, kind: { t: "List", c: null } };

      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));

      await codec.writeMessage(msg);

      // Give time for the data event
      await new Promise((r) => setTimeout(r, 10));

      const written = Buffer.concat(chunks).toString();
      expect(written).toBe(JSON.stringify(msg) + "\n");
    });
  });

  describe("round-trip", () => {
    test("write then read preserves message", async () => {
      // Use two streams connected back-to-back
      const a = new PassThrough();
      const writerCodec = new LineCodec(a);
      const readerCodec = new LineCodec(a);

      const original = { id: 99, kind: { t: "List", c: null } };
      await writerCodec.writeMessage(original);

      const received = await readerCodec.readMessage();
      expect(received).toEqual(original);
    });
  });
});
