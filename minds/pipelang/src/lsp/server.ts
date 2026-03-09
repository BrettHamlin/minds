#!/usr/bin/env bun
// Pipelang LSP server — run as a subprocess by editors
// Communicates over stdin/stdout using the Language Server Protocol.
//
// Usage (from VS Code extension):
//   serverOptions: { command: "bun", args: ["pipelang/src/lsp/server.ts"] }

import { LspTransport } from "./transport";
import { getDiagnostics } from "./diagnostics";
import { getDefinition } from "./definition";
import { getRename, prepareRename } from "./rename";
import { getCompletions } from "./completion";
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  InitializeResult,
} from "./protocol";

// ── Document store ────────────────────────────────────────────────────────────

const documents = new Map<string, string>();

// ── Transport ─────────────────────────────────────────────────────────────────

const transport = new LspTransport(process.stdin, process.stdout, handleMessage);

function respond(id: number | string | null, result: unknown): void {
  transport.send({ jsonrpc: "2.0", id, result });
}

function respondError(id: number | string | null, code: number, message: string): void {
  transport.send({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method: string, params: unknown): void {
  transport.send({ jsonrpc: "2.0", method, params });
}

function publishDiagnostics(uri: string, text: string): void {
  const diagnostics = getDiagnostics(text);
  notify("textDocument/publishDiagnostics", { uri, diagnostics });
}

// ── Message dispatcher ────────────────────────────────────────────────────────

function handleMessage(msg: JsonRpcMessage): void {
  if ("method" in msg) {
    if ("id" in msg) {
      // Request (has id + method)
      handleRequest(msg as JsonRpcRequest);
    } else {
      // Notification (method only)
      handleNotification(msg as { method: string; params?: unknown });
    }
  }
  // Responses from the client (e.g. window/workDoneProgress) — ignore
}

function handleRequest(req: JsonRpcRequest): void {
  const { id, method, params } = req;
  const p = params as Record<string, unknown>;

  try {
    switch (method) {
      case "initialize":
        respond(id, {
          capabilities: {
            textDocumentSync: 1, // Full sync
            definitionProvider: true,
            renameProvider: true,
            prepareRenameProvider: true,
            completionProvider: {
              triggerCharacters: [".", ":"],
              resolveProvider: false,
            },
          },
        } satisfies InitializeResult);
        break;

      case "shutdown":
        respond(id, null);
        break;

      case "textDocument/definition": {
        const uri = (p?.textDocument as { uri: string })?.uri;
        const position = p?.position as { line: number; character: number };
        const text = documents.get(uri);
        if (!text || !position) { respond(id, null); break; }
        const loc = getDefinition(text, uri, position);
        respond(id, loc);
        break;
      }

      case "textDocument/prepareRename": {
        const uri = (p?.textDocument as { uri: string })?.uri;
        const position = p?.position as { line: number; character: number };
        const text = documents.get(uri);
        if (!text || !position) { respond(id, null); break; }
        const info = prepareRename(text, position);
        if (!info) { respond(id, null); break; }
        // Return the range of the word to rename
        respond(id, {
          start: { line: position.line, character: position.character },
          end: { line: position.line, character: position.character + info.word.length },
        });
        break;
      }

      case "textDocument/rename": {
        const uri = (p?.textDocument as { uri: string })?.uri;
        const position = p?.position as { line: number; character: number };
        const newName = p?.newName as string;
        const text = documents.get(uri);
        if (!text || !position || !newName) { respond(id, null); break; }
        const edit = getRename(text, uri, position, newName);
        respond(id, edit);
        break;
      }

      case "textDocument/completion": {
        const uri = (p?.textDocument as { uri: string })?.uri;
        const position = p?.position as { line: number; character: number };
        const text = documents.get(uri);
        if (!text || !position) { respond(id, []); break; }
        const items = getCompletions(text, position);
        respond(id, items);
        break;
      }

      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    respondError(id, -32603, `Internal error: ${msg}`);
  }
}

function handleNotification(notif: { method: string; params?: unknown }): void {
  const p = (notif.params ?? {}) as Record<string, unknown>;

  switch (notif.method) {
    case "initialized":
      // No-op — server is ready
      break;

    case "textDocument/didOpen": {
      const item = p?.textDocument as { uri: string; text: string };
      if (item?.uri && item?.text !== undefined) {
        documents.set(item.uri, item.text);
        publishDiagnostics(item.uri, item.text);
      }
      break;
    }

    case "textDocument/didChange": {
      const uri = (p?.textDocument as { uri: string })?.uri;
      const changes = p?.contentChanges as Array<{ text: string }>;
      if (uri && changes?.length > 0) {
        const text = changes[changes.length - 1].text;
        documents.set(uri, text);
        publishDiagnostics(uri, text);
      }
      break;
    }

    case "textDocument/didClose": {
      const uri = (p?.textDocument as { uri: string })?.uri;
      if (uri) {
        documents.delete(uri);
        // Clear diagnostics on close
        notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
      }
      break;
    }

    case "exit":
      process.exit(0);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

transport.start();
