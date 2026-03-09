"use strict";
// Pipelang VS Code extension
// Starts the pipelang LSP server as a subprocess and connects via stdio.
//
// Server resolution strategy:
//   run  (installed VSIX) — uses the pre-bundled out/server.js, run with `node`.
//                           Built during `npm run build` via `bun build … --outfile out/server.js`.
//   debug (dev / source)  — uses the live TypeScript source via `bun`, so edits take
//                           effect on the next extension reload without a rebuild.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
let client;
function activate(context) {
    const config = vscode_1.workspace.getConfiguration("pipelang");
    const customServerPath = config.get("serverPath") || "";
    let serverOptions;
    if (customServerPath) {
        // User explicitly configured a server path — honour it as-is.
        serverOptions = {
            command: "bun",
            args: [customServerPath],
            transport: node_1.TransportKind.stdio,
        };
    }
    else {
        // Production (VSIX): use the bundled standalone JS, run with node.
        // The bundle is produced by `npm run build` (bun build … --outfile out/server.js).
        const bundledServer = context.asAbsolutePath(path.join("out", "server.js"));
        // Development: use the live TypeScript source via bun for instant edits.
        const devServer = context.asAbsolutePath(path.join("..", "..", "src", "lsp", "server.ts"));
        serverOptions = {
            run: {
                command: "node",
                args: [bundledServer],
                transport: node_1.TransportKind.stdio,
            },
            debug: {
                command: "bun",
                args: [devServer],
                transport: node_1.TransportKind.stdio,
            },
        };
    }
    const clientOptions = {
        documentSelector: [{ scheme: "file", language: "pipelang" }],
        synchronize: {
            fileEvents: vscode_1.workspace.createFileSystemWatcher("**/*.pipeline"),
        },
    };
    client = new node_1.LanguageClient("pipelang", "Pipelang Language Server", serverOptions, clientOptions);
    client.start();
    context.subscriptions.push(client);
}
function deactivate() {
    return client?.stop();
}
//# sourceMappingURL=extension.js.map