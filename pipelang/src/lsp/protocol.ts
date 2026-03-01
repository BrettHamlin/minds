// Minimal LSP protocol type definitions (Language Server Protocol 3.17)
// No external dependencies — just the types we need.

export interface Position {
  /** 0-indexed */
  line: number;
  /** 0-indexed */
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentContentChangeEvent {
  text: string;
}

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;
export type DiagnosticSeverityValue = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export interface Diagnostic {
  range: Range;
  severity: DiagnosticSeverityValue;
  message: string;
  source?: string;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
}

export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;
export type CompletionItemKindValue = (typeof CompletionItemKind)[keyof typeof CompletionItemKind];

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKindValue;
  detail?: string;
  insertText?: string;
}

export interface InitializeResult {
  capabilities: ServerCapabilities;
}

export interface ServerCapabilities {
  textDocumentSync?: number;
  definitionProvider?: boolean;
  renameProvider?: boolean;
  prepareRenameProvider?: boolean;
  completionProvider?: {
    triggerCharacters?: string[];
    resolveProvider?: boolean;
  };
}

// JSON-RPC message shapes
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// LSP error codes
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  RequestCancelled: -32800,
} as const;
