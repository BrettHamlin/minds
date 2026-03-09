// Pipelang VS Code extension
// Starts the pipelang LSP server as a subprocess and connects via stdio.
//
// Server resolution strategy:
//   run  (installed VSIX) — uses the pre-bundled out/server.js, run with `node`.
//                           Built during `npm run build` via `bun build … --outfile out/server.js`.
//   debug (dev / source)  — uses the live TypeScript source via `bun`, so edits take
//                           effect on the next extension reload without a rebuild.

import * as path from "path";
import { workspace, ExtensionContext } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("pipelang");
  const customServerPath = config.get<string>("serverPath") || "";

  let serverOptions: ServerOptions;

  if (customServerPath) {
    // User explicitly configured a server path — honour it as-is.
    serverOptions = {
      command: "bun",
      args: [customServerPath],
      transport: TransportKind.stdio,
    };
  } else {
    // Production (VSIX): use the bundled standalone JS, run with node.
    // The bundle is produced by `npm run build` (bun build … --outfile out/server.js).
    const bundledServer = context.asAbsolutePath(path.join("out", "server.js"));

    // Development: use the live TypeScript source via bun for instant edits.
    const devServer = context.asAbsolutePath(
      path.join("..", "..", "src", "lsp", "server.ts")
    );

    serverOptions = {
      run: {
        command: "node",
        args: [bundledServer],
        transport: TransportKind.stdio,
      },
      debug: {
        command: "bun",
        args: [devServer],
        transport: TransportKind.stdio,
      },
    };
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "pipelang" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.pipeline"),
    },
  };

  client = new LanguageClient(
    "pipelang",
    "Pipelang Language Server",
    serverOptions,
    clientOptions
  );

  client.start();
  context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
