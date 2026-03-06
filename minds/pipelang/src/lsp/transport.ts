// LSP message transport — Content-Length framing over stdin/stdout
// LSP spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart

import type { JsonRpcMessage } from "./protocol";

export type MessageCallback = (msg: JsonRpcMessage) => void;

export class LspTransport {
  private buffer = "";
  private pendingLength: number | null = null;

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
    private readonly onMessage: MessageCallback
  ) {}

  start(): void {
    this.input.setEncoding("utf8");
    this.input.on("data", (chunk: string) => this.onData(chunk));
    this.input.on("end", () => process.exit(0));
  }

  send(message: JsonRpcMessage): void {
    const body = JSON.stringify(message);
    const byteLength = Buffer.byteLength(body, "utf8");
    this.output.write(`Content-Length: ${byteLength}\r\n\r\n${body}`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    this.processBuffer();
  }

  private processBuffer(): void {
    while (true) {
      // Phase 1: read headers until \r\n\r\n
      if (this.pendingLength === null) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headerStr = this.buffer.slice(0, headerEnd);
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Malformed header — skip to next header boundary
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        this.pendingLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      // Phase 2: wait until we have the full body
      if (this.buffer.length < this.pendingLength) return;

      const bodyBytes = Buffer.from(this.buffer, "utf8").slice(0, this.pendingLength);
      const body = bodyBytes.toString("utf8");
      // Advance buffer by byte length (not char length — they can differ for non-ASCII)
      this.buffer = Buffer.from(this.buffer, "utf8").slice(this.pendingLength).toString("utf8");
      this.pendingLength = null;

      try {
        const msg = JSON.parse(body) as JsonRpcMessage;
        this.onMessage(msg);
      } catch {
        // Ignore unparseable messages
      }
    }
  }
}
