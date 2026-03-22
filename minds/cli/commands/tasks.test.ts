import { describe, test, expect } from "bun:test";
import {
  extractJson,
  addDependsOnToHeader,
  assembleTasksMd,
  injectE2eTasks,
  extendE2eBoundaries,
  inferImplicitDependencies,
  autoFixLintErrors,
} from "./tasks.ts";
import type { TasksContext } from "../lib/tasks-context.ts";
import type { LintError } from "../../lib/contracts.ts";

// ---------------------------------------------------------------------------
// extractJson
// ---------------------------------------------------------------------------

describe("extractJson", () => {
  test("extracts raw JSON object", () => {
    const result = extractJson('{"minds": []}');
    expect(JSON.parse(result)).toEqual({ minds: [] });
  });

  test("extracts JSON from code-fenced block", () => {
    const result = extractJson('```json\n{"minds": []}\n```');
    expect(JSON.parse(result)).toEqual({ minds: [] });
  });

  test("extracts JSON from code fence without json tag", () => {
    const result = extractJson('```\n{"minds": []}\n```');
    expect(JSON.parse(result)).toEqual({ minds: [] });
  });

  test("extracts JSON with prose preamble before code fence", () => {
    const result = extractJson('Here is your result:\n\n```json\n{"minds": []}\n```');
    expect(JSON.parse(result)).toEqual({ minds: [] });
  });

  test("extracts JSON with trailing explanation", () => {
    const result = extractJson('```json\n{"minds": []}\n```\n\nI hope this helps!');
    expect(JSON.parse(result)).toEqual({ minds: [] });
  });

  test("extracts raw JSON with prose before and after", () => {
    const result = extractJson('Result: {"minds": []} Done.');
    expect(JSON.parse(result)).toEqual({ minds: [] });
  });

  test("returns trimmed raw input when no JSON found", () => {
    const result = extractJson("  no json here  ");
    expect(result).toBe("no json here");
  });
});

// ---------------------------------------------------------------------------
// addDependsOnToHeader
// ---------------------------------------------------------------------------

describe("addDependsOnToHeader", () => {
  test("adds depends on to bare header", () => {
    const content = "## @server-core Tasks\n\n- [ ] T001 task";
    const result = addDependsOnToHeader(content, "server-core", "config-module");
    expect(result).toContain("## @server-core Tasks (depends on: @config-module)");
  });

  test("adds depends on to header with existing owns:", () => {
    const content = "## @config-module Tasks (owns: packages/modules/config/**)\n";
    const result = addDependsOnToHeader(content, "config-module", "server-core");
    expect(result).toContain("depends on: @server-core");
    expect(result).toContain("owns:");
  });

  test("appends to existing depends on:", () => {
    const content = "## @config-module Tasks (depends on: @server-core)\n";
    const result = addDependsOnToHeader(content, "config-module", "auth-module");
    expect(result).toContain("@server-core");
    expect(result).toContain("@auth-module");
  });

  test("does nothing if dep already present", () => {
    const content = "## @config-module Tasks (depends on: @server-core)\n";
    const result = addDependsOnToHeader(content, "config-module", "server-core");
    expect(result).toBe(content);
  });

  test("returns unchanged content if mind not found", () => {
    const content = "## @other Tasks\n";
    const result = addDependsOnToHeader(content, "nonexistent", "dep");
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// assembleTasksMd
// ---------------------------------------------------------------------------

describe("assembleTasksMd", () => {
  const baseCtx: TasksContext = {
    repoRoot: "/tmp",
    mindsDir: "/tmp/.minds",
    registry: [],
    featureDir: "/tmp/specs/BRE-700",
    ticketId: "BRE-700",
    testFramework: "bun:test",
    hasE2eInfra: false,
    e2eRegistrySchema: null,
    mockupPath: null,
  };

  test("generates sequential task IDs", () => {
    const result = assembleTasksMd(baseCtx, {
      minds: [{
        name: "config-module",
        isNew: true,
        ownsFiles: ["packages/modules/config/**"],
        dependsOn: [],
        tasks: [
          { description: "Task one", parallel: false },
          { description: "Task two", parallel: true },
        ],
      }],
    });
    expect(result).toContain("T001");
    expect(result).toContain("T002");
    expect(result).toContain("[P]");
  });

  test("includes owns: for new minds", () => {
    const result = assembleTasksMd(baseCtx, {
      minds: [{
        name: "config-module",
        isNew: true,
        ownsFiles: ["packages/modules/config/**"],
        dependsOn: [],
        tasks: [{ description: "Task", parallel: false }],
      }],
    });
    expect(result).toContain("owns: packages/modules/config/**");
  });

  test("includes depends on: when present", () => {
    const result = assembleTasksMd(baseCtx, {
      minds: [{
        name: "server-core",
        isNew: false,
        dependsOn: ["config-module"],
        tasks: [{ description: "Task", parallel: false }],
      }],
    });
    expect(result).toContain("depends on: @config-module");
  });

  test("generates cross-mind contracts table", () => {
    const result = assembleTasksMd(baseCtx, {
      minds: [{
        name: "server-core",
        isNew: false,
        dependsOn: ["config-module"],
        tasks: [{ description: "Task", parallel: false }],
      }],
    });
    expect(result).toContain("## Cross-Mind Contracts");
    expect(result).toContain("@config-module");
    expect(result).toContain("@server-core");
  });

  test("IDs are sequential across multiple minds", () => {
    const result = assembleTasksMd(baseCtx, {
      minds: [
        { name: "a", isNew: false, dependsOn: [], tasks: [{ description: "A1", parallel: false }, { description: "A2", parallel: false }] },
        { name: "b", isNew: false, dependsOn: [], tasks: [{ description: "B1", parallel: false }] },
      ],
    });
    expect(result).toContain("T001 @a");
    expect(result).toContain("T002 @a");
    expect(result).toContain("T003 @b");
  });
});

// ---------------------------------------------------------------------------
// injectE2eTasks
// ---------------------------------------------------------------------------

describe("injectE2eTasks", () => {
  const ctx: TasksContext = {
    repoRoot: "/tmp",
    mindsDir: "/tmp/.minds",
    registry: [],
    featureDir: "/tmp/specs/BRE-700",
    ticketId: "BRE-700",
    testFramework: "bun:test",
    hasE2eInfra: true,
    e2eRegistrySchema: null,
    mockupPath: "~/Documents/blueprint/configv1.html",
  };

  test("returns null when no mockup", () => {
    const noMockup = { ...ctx, mockupPath: null };
    const result = injectE2eTasks(noMockup, "content", { minds: [] });
    expect(result).toBeNull();
  });

  test("returns null when no E2E infra", () => {
    const noE2e = { ...ctx, hasE2eInfra: false };
    const result = injectE2eTasks(noE2e, "content", { minds: [] });
    expect(result).toBeNull();
  });

  test("injects E2E task inside the correct mind section", () => {
    const content = "## @config-module Tasks (owns: packages/modules/config/**)\n\n- [ ] T001 @config-module Scaffold\n\n## @server-core Tasks\n\n- [ ] T002 @server-core Register\n";
    const result = injectE2eTasks(ctx, content, {
      minds: [
        { name: "config-module", isNew: true, ownsFiles: ["packages/modules/config/**"], dependsOn: [], tasks: [{ description: "Scaffold", parallel: false }] },
        { name: "server-core", isNew: false, dependsOn: [], tasks: [{ description: "Register", parallel: false }] },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.mindName).toBe("config-module");
    // E2E task should appear before ## @server-core
    const e2eIdx = result!.content.indexOf("tests/e2e/config-module.test.ts");
    const serverIdx = result!.content.indexOf("## @server-core");
    expect(e2eIdx).toBeGreaterThan(-1);
    expect(e2eIdx).toBeLessThan(serverIdx);
  });
});

// ---------------------------------------------------------------------------
// extendE2eBoundaries
// ---------------------------------------------------------------------------

describe("extendE2eBoundaries", () => {
  const ctx: TasksContext = {
    repoRoot: "/tmp",
    mindsDir: "/tmp/.minds",
    registry: [],
    featureDir: "/tmp/specs/BRE-700",
    ticketId: "BRE-700",
    testFramework: "bun:test",
    hasE2eInfra: true,
    e2eRegistrySchema: null,
    mockupPath: null,
  };

  test("extends owns: with E2E boundary", () => {
    const content = "## @config-module Tasks (owns: packages/modules/config/**)\n";
    const result = extendE2eBoundaries(ctx, content, "config-module");
    expect(result).toContain("tests/e2e/config-module*");
    expect(result).toContain("owns:");
  });

  test("adds owns: to bare header", () => {
    const content = "## @config-module Tasks\n";
    const result = extendE2eBoundaries(ctx, content, "config-module");
    expect(result).toContain("owns: tests/e2e/config-module*");
  });

  test("does not duplicate if already present", () => {
    const content = "## @config-module Tasks (owns: packages/modules/config/**, tests/e2e/config-module*)\n";
    const result = extendE2eBoundaries(ctx, content, "config-module");
    const count = (result.match(/tests\/e2e\/config-module/g) ?? []).length;
    expect(count).toBe(1);
  });

  test("does not modify other minds", () => {
    const content = "## @config-module Tasks (owns: a/**)\n\n## @server-core Tasks\n";
    const result = extendE2eBoundaries(ctx, content, "config-module");
    expect(result).toContain("tests/e2e/config-module*");
    expect(result).not.toContain("tests/e2e/server-core*");
  });
});

// ---------------------------------------------------------------------------
// inferImplicitDependencies
// ---------------------------------------------------------------------------

describe("inferImplicitDependencies", () => {
  const ctx: TasksContext = {
    repoRoot: "/tmp",
    mindsDir: "/tmp/.minds",
    registry: [
      { name: "server-core", domain: "core", keywords: [], owns_files: ["packages/core/**"], capabilities: [] },
      { name: "config-module", domain: "config", keywords: [], owns_files: ["packages/modules/config/**"], capabilities: [] },
    ],
    featureDir: "/tmp/specs/BRE-700",
    ticketId: "BRE-700",
    testFramework: "bun:test",
    hasE2eInfra: false,
    e2eRegistrySchema: null,
    mockupPath: null,
  };

  test("adds dependency when task references file owned by another mind", () => {
    const content = "## @server-core Tasks\n\n- [ ] T001 @server-core Register config in packages/modules/config/module.ts\n";
    const result = inferImplicitDependencies(ctx, content, {
      minds: [{
        name: "server-core",
        isNew: false,
        dependsOn: [],
        tasks: [{ description: "Register config in packages/modules/config/module.ts", parallel: false }],
      }],
    });
    expect(result).toContain("depends on: @config-module");
  });

  test("does not add self-dependency", () => {
    const content = "## @config-module Tasks (owns: packages/modules/config/**)\n\n- [ ] T001 @config-module Create packages/modules/config/api.ts\n";
    const result = inferImplicitDependencies(ctx, content, {
      minds: [{
        name: "config-module",
        isNew: true,
        ownsFiles: ["packages/modules/config/**"],
        dependsOn: [],
        tasks: [{ description: "Create packages/modules/config/api.ts", parallel: false }],
      }],
    });
    expect(result).not.toContain("depends on:");
  });

  test("does not duplicate existing dependency", () => {
    const content = "## @server-core Tasks (depends on: @config-module)\n\n- [ ] T001 @server-core Use packages/modules/config/module.ts\n";
    const result = inferImplicitDependencies(ctx, content, {
      minds: [{
        name: "server-core",
        isNew: false,
        dependsOn: ["config-module"],
        tasks: [{ description: "Use packages/modules/config/module.ts", parallel: false }],
      }],
    });
    // Should not have duplicate @config-module
    const count = (result.match(/@config-module/g) ?? []).length;
    expect(count).toBe(1);
  });

  test("no changes when task has no file paths", () => {
    const content = "## @server-core Tasks\n\n- [ ] T001 @server-core Add config to modules array\n";
    const result = inferImplicitDependencies(ctx, content, {
      minds: [{
        name: "server-core",
        isNew: false,
        dependsOn: [],
        tasks: [{ description: "Add config to modules array", parallel: false }],
      }],
    });
    expect(result).not.toContain("depends on:");
  });
});

// ---------------------------------------------------------------------------
// autoFixLintErrors
// ---------------------------------------------------------------------------

describe("autoFixLintErrors", () => {
  test("fixes implicit_cross_mind_dep by adding depends on:", () => {
    const content = "## @server-core Tasks\n\n- [ ] T001 @server-core Register module\n";
    const errors: LintError[] = [{
      type: "implicit_cross_mind_dep",
      task: "T001",
      message: 'Task T001 (@server-core) references path "packages/modules/config/module.ts" which is owned by @config-module, but the section header does not declare (depends on: @config-module).',
    }];
    const result = autoFixLintErrors(content, errors);
    expect(result).toContain("depends on: @config-module");
  });

  test("fixes cross_mind_leakage by stripping @ prefix", () => {
    const content = "## @config-module Tasks\n\n- [ ] T001 @config-module Import from @server-core types\n";
    const errors: LintError[] = [{
      type: "cross_mind_leakage",
      task: "T001",
      message: "Task T001 references @server-core in description — only import paths in consumes: are allowed",
    }];
    const result = autoFixLintErrors(content, errors);
    expect(result).toContain("Import from server-core types");
    expect(result).not.toContain("@server-core");
  });

  test("handles non-auto-fixable error types gracefully (no changes)", () => {
    const content = "## @foo Tasks\n\n- [ ] T001 @foo Task\n";
    const errors: LintError[] = [{
      type: "path_traversal",
      task: "T001",
      message: "Some path traversal error",
    }];
    const result = autoFixLintErrors(content, errors);
    expect(result).toBe(content);
  });

  test("fixes multiple errors in sequence", () => {
    const content = "## @server-core Tasks\n\n- [ ] T001 @server-core Import from @config-module path packages/modules/config/api.ts\n";
    const errors: LintError[] = [
      {
        type: "cross_mind_leakage",
        task: "T001",
        message: "Task T001 references @config-module in description — only import paths in consumes: are allowed",
      },
      {
        type: "implicit_cross_mind_dep",
        task: "T001",
        message: 'Task T001 (@server-core) references path "packages/modules/config/api.ts" which is owned by @config-module, but the section header does not declare (depends on: @config-module).',
      },
    ];
    const result = autoFixLintErrors(content, errors);
    expect(result).not.toContain("@config-module in description");
    expect(result).toContain("depends on: @config-module");
  });
});
