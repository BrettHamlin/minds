/**
 * Router Mind tests.
 *
 * Tests are organised into three layers:
 *  1. describe() — validates the Router's static description
 *  2. Routing logic — 10+ diverse queries across all 12 Mind domains (BM25-only, no processes)
 *  3. Fallback — escalate when no child matches
 *
 * We do NOT spawn actual child processes here — that's covered by the
 * discovery.test.ts integration tests. Instead we exercise MindRouter directly
 * with realistic Mind descriptions matching each sibling.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { MindRouter } from "@minds/router";
import { validateMindDescription } from "@minds/mind";
import { ROUTER_DESCRIPTION } from "./server";
import type { MindDescription } from "@minds/mind";

// ---------------------------------------------------------------------------
// All 12 sibling Mind descriptions (mirroring their actual domains/keywords)
// ---------------------------------------------------------------------------

const PIPELINE_CORE: MindDescription = {
  name: "pipeline_core",
  domain: "Pipeline types, registry CRUD, signal definitions, phase transitions, paths, repo-registry",
  keywords: ["pipeline", "registry", "phase", "transition", "ticket", "paths", "signal", "repo"],
  owns_files: ["minds/pipeline_core/"],
  capabilities: ["read registry", "write registry", "define phases", "manage paths", "load pipeline config"],
};

const EXECUTION: MindDescription = {
  name: "execution",
  domain: "Phase dispatch, gate evaluation, orchestrator init, phase executors, hooks, retry config, execution mode",
  keywords: ["execute", "dispatch", "gate", "orchestrator", "hook", "retry", "phase", "init"],
  owns_files: ["minds/execution/"],
  capabilities: ["dispatch phases", "evaluate gates", "initialize orchestrator", "manage retries", "detect execution mode"],
};

const COORDINATION: MindDescription = {
  name: "coordination",
  domain: "Dependency holds, group management, batch Q&A, held-release scan, ticket resolution",
  keywords: ["coordination", "dependency", "hold", "group", "batch", "resolve", "ticket", "wait"],
  owns_files: ["minds/coordination/"],
  capabilities: ["manage dependency holds", "coordinate groups", "batch Q&A", "scan held tickets", "resolve multi-ticket"],
};

const OBSERVABILITY: MindDescription = {
  name: "observability",
  domain: "Metrics, run classification, draft PR, gate accuracy, autonomy rate, dashboard, statusline",
  keywords: ["metrics", "dashboard", "autonomy", "accuracy", "status", "monitor", "classify", "draft", "pr"],
  owns_files: ["minds/observability/"],
  capabilities: ["track metrics", "generate dashboard", "classify runs", "monitor gate accuracy", "measure autonomy rate"],
};

const SIGNALS: MindDescription = {
  name: "signals",
  domain: "Signal emission handlers, transport dispatch, token resolution, emit-findings",
  keywords: ["signal", "emit", "transport", "token", "findings", "queue", "event"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals", "resolve signal names", "dispatch to transport", "emit findings"],
};

const TRANSPORT: MindDescription = {
  name: "transport",
  domain: "Transport interface, TmuxTransport, BusTransport, bus server, status aggregation, resolve-transport",
  keywords: ["transport", "tmux", "bus", "server", "status", "aggregate", "resolve"],
  owns_files: ["minds/transport/"],
  capabilities: ["tmux transport", "bus transport", "aggregate status", "resolve transport layer"],
};

const CLI: MindDescription = {
  name: "cli",
  domain: "collab binary, arg parsing, package registry, repo management, semver",
  keywords: ["cli", "command", "binary", "package", "install", "semver", "repo", "arg"],
  owns_files: ["minds/cli/"],
  capabilities: ["parse CLI args", "install packages", "manage repos", "resolve semver", "run collab commands"],
};

const INSTALLER: MindDescription = {
  name: "installer",
  domain: "File mapping, distribution logic, install hooks, upgrade paths",
  keywords: ["installer", "install", "file", "distribute", "upgrade", "hook", "map"],
  owns_files: ["minds/installer/"],
  capabilities: ["map files to destinations", "run install hooks", "handle upgrade paths", "distribute templates"],
};

const TEMPLATES: MindDescription = {
  name: "templates",
  domain: "All distributable config, scripts, schemas, gate prompts (pure data)",
  keywords: ["template", "config", "schema", "script", "gate", "prompt", "data", "distributable"],
  owns_files: ["minds/templates/"],
  capabilities: ["provide config templates", "provide schema definitions", "provide gate prompts", "supply scripts"],
};

const SPEC_API: MindDescription = {
  name: "spec_api",
  domain: "HTTP REST API gateway for spec creation workflows. Delegates business logic to SpecEngine child.",
  keywords: ["http", "api", "rest", "endpoint", "request", "response", "spec", "specfactory"],
  owns_files: ["minds/spec_api/"],
  capabilities: ["serve HTTP REST endpoints", "route requests to SpecEngine", "validate HTTP inputs", "format HTTP responses"],
};

const INTEGRATIONS: MindDescription = {
  name: "integrations",
  domain: "Slack adapter and future Discord, Teams integrations",
  keywords: ["slack", "discord", "teams", "integration", "webhook", "notification", "message", "channel"],
  owns_files: ["minds/integrations/"],
  capabilities: ["send Slack messages", "handle Slack webhooks", "post notifications", "manage integration channels"],
};

const PIPELANG: MindDescription = {
  name: "pipelang",
  domain: "DSL lexer, parser, compiler, validator, LSP for pipeline language",
  keywords: ["dsl", "lexer", "parser", "compiler", "validator", "lsp", "language", "syntax", "pipelang"],
  owns_files: ["minds/pipelang/"],
  capabilities: ["lex DSL input", "parse pipeline DSL", "compile pipeline definitions", "validate DSL syntax", "LSP completions"],
};

const ALL_SIBLING_MINDS = [
  PIPELINE_CORE,
  EXECUTION,
  COORDINATION,
  OBSERVABILITY,
  SIGNALS,
  TRANSPORT,
  CLI,
  INSTALLER,
  TEMPLATES,
  SPEC_API,
  INTEGRATIONS,
  PIPELANG,
];

// ---------------------------------------------------------------------------
// 1. describe() validation
// ---------------------------------------------------------------------------

describe("Router describe()", () => {
  it("ROUTER_DESCRIPTION is a valid MindDescription", () => {
    expect(validateMindDescription(ROUTER_DESCRIPTION)).toBe(true);
  });

  it("name is 'router'", () => {
    expect(ROUTER_DESCRIPTION.name).toBe("router");
  });

  it("domain describes routing function", () => {
    expect(ROUTER_DESCRIPTION.domain.toLowerCase()).toContain("rout");
  });

  it("owns_files contains minds/router/", () => {
    expect(ROUTER_DESCRIPTION.owns_files).toContain("minds/router/");
  });

  it("keywords include routing vocabulary", () => {
    expect(ROUTER_DESCRIPTION.keywords).toContain("route");
    expect(ROUTER_DESCRIPTION.keywords).toContain("discover");
  });

  it("capabilities include discovery and routing", () => {
    const caps = ROUTER_DESCRIPTION.capabilities.join(" ").toLowerCase();
    expect(caps).toContain("discover");
    expect(caps).toContain("route");
  });
});

// ---------------------------------------------------------------------------
// 2. Routing logic — 10+ diverse queries (BM25-only, no child processes)
// ---------------------------------------------------------------------------

describe("Router routing — 12 sibling Minds (BM25-only)", () => {
  let router: MindRouter;

  beforeEach(async () => {
    router = new MindRouter();
    for (const mind of ALL_SIBLING_MINDS) {
      await router.addChild(mind);
    }
  });

  it("indexes all 12 sibling Minds", () => {
    expect(router.childCount).toBe(12);
  });

  it("routes 'emit a signal' to signals Mind", async () => {
    const matches = await router.route("emit a signal for the pipeline");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("signals");
  });

  it("routes 'dispatch phase' to execution Mind", async () => {
    const matches = await router.route("dispatch the next phase in the orchestrator");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("execution");
  });

  it("routes 'install package' to cli Mind", async () => {
    const matches = await router.route("install a package from the registry using the cli");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("cli");
  });

  it("routes 'slack notification' to integrations Mind", async () => {
    const matches = await router.route("send a slack notification to the channel");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("integrations");
  });

  it("routes 'metrics dashboard' to observability Mind", async () => {
    const matches = await router.route("show metrics on the autonomy dashboard");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("observability");
  });

  it("routes 'tmux transport' to transport Mind", async () => {
    const matches = await router.route("resolve the tmux transport for the bus");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("transport");
  });

  it("routes 'registry CRUD' to pipeline_core Mind", async () => {
    const matches = await router.route("read the pipeline registry for this ticket");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("pipeline_core");
  });

  it("routes 'DSL parser' to pipelang Mind", async () => {
    const matches = await router.route("parse this pipeline DSL syntax");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("pipelang");
  });

  it("routes 'HTTP REST spec' to spec_api Mind", async () => {
    const matches = await router.route("call the REST API endpoint for spec creation");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("spec_api");
  });

  it("routes 'install hooks upgrade' to installer Mind", async () => {
    const matches = await router.route("run install hooks for the upgrade path");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("installer");
  });

  it("routes 'config schema template' to templates Mind", async () => {
    const matches = await router.route("get the config schema template for the gate prompt");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("templates");
  });

  it("routes 'dependency hold resolve' to coordination Mind", async () => {
    const matches = await router.route("check dependency holds and resolve the batch ticket");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].mind.name).toBe("coordination");
  });

  it("first match has role=primary, rest have role=support", async () => {
    const matches = await router.route("emit signal phase dispatch");
    expect(matches.length).toBeGreaterThan(1);
    expect(matches[0].role).toBe("primary");
    for (const m of matches.slice(1)) {
      expect(m.role).toBe("support");
    }
  });

  it("all matches have score > 0", async () => {
    const matches = await router.route("pipeline dispatch gate retry");
    for (const m of matches) {
      expect(m.score).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Fallback — escalate when no child matches
// ---------------------------------------------------------------------------

describe("Router escalate fallback", () => {
  it("empty router returns no matches for any query", async () => {
    const emptyRouter = new MindRouter();
    const matches = await emptyRouter.route("emit a signal");
    expect(matches).toHaveLength(0);
  });

  it("gibberish query returns no matches (triggers escalate path)", async () => {
    const router = new MindRouter();
    for (const mind of ALL_SIBLING_MINDS) {
      await router.addChild(mind);
    }
    const matches = await router.route("zzzzz xxxxxxxxxxx qqqqqq");
    expect(matches).toHaveLength(0);
  });
});
