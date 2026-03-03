/**
 * group2-static.test.ts - Static analysis checks on command and config files
 *
 * Verifies that command files, gate definitions, handler scripts, and
 * pipeline.json contain the correct instructions, tokens, and structure.
 *
 * These are pure file-content checks with no subprocess execution.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
  cwd: import.meta.dir,
}).trim();

function readSourceFile(relativePath: string): string {
  const fullPath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

// ===========================================================================
// Section delimiter tests (3 tests)
// ===========================================================================

describe("section delimiter in signal pipeline", () => {
  test("1. collab.clarify.md emits section delimiter in signal", () => {
    const content = readSourceFile("src/commands/collab.clarify.md");

    // The file must contain the section delimiter character in the context
    // of the emit-question-signal.ts command usage
    expect(content).toContain("\u00A7");
    expect(content).toContain("emit-question-signal.ts");
  });

  test("2. collab.run.md has section delimiter parsing instruction", () => {
    const content = readSourceFile("src/commands/collab.run.md");

    // The orchestrator must know to split on section delimiter
    expect(content).toContain("Split");
    expect(content).toContain("\u00A7");
  });

  test("3. pipeline-signal.ts truncateDetail only uses substring (no character filtering)", () => {
    const content = readSourceFile("src/handlers/pipeline-signal.ts");

    // Find the truncateDetail function body
    const funcStart = content.indexOf("function truncateDetail");
    expect(funcStart).toBeGreaterThan(-1);

    // Extract function body (from the opening { to the next function or end)
    const funcBody = content.substring(funcStart);

    // Verify it uses .substring and .length for truncation
    expect(funcBody).toContain(".substring");
    expect(funcBody).toContain(".length");

    // Verify it does NOT use replace or filter (which would strip characters)
    // Only check within the truncateDetail function, not the whole file
    const funcEnd = funcBody.indexOf("\n}");
    const truncateBody = funcBody.substring(0, funcEnd > 0 ? funcEnd : funcBody.length);
    expect(truncateBody).not.toContain(".replace");
    expect(truncateBody).not.toContain(".filter");
  });
});

// ===========================================================================
// analysis.md write tests (2 tests)
// ===========================================================================

describe("collab.analyze.md file write instructions", () => {
  test("4. collab.analyze.md instructs writing to analysis.md", () => {
    const content = readSourceFile("src/commands/collab.analyze.md");

    // Must instruct the agent to write the report to analysis.md
    expect(content).toContain("write it to");
    expect(content).toContain("analysis.md");
  });

  test("5. collab.analyze.md instructs file write BEFORE signal emission", () => {
    const content = readSourceFile("src/commands/collab.analyze.md");

    // The step 6 write instruction must appear before the step 8 signal emission.
    // We use the step 8 heading as the signal position marker (not the first
    // mention of verify-and-complete.sh, which appears in the preamble).
    const writePos = content.indexOf("write it to");
    const signalStepPos = content.indexOf("### 8. Verify Completion and Emit Signal");

    expect(writePos).toBeGreaterThan(-1);
    expect(signalStepPos).toBeGreaterThan(-1);
    expect(writePos).toBeLessThan(signalStepPos);
  });
});

// ===========================================================================
// analyze gate rule tests (4 tests)
// ===========================================================================

describe("analyze gate (src/config/gates/analyze.md)", () => {
  test("6. analyze gate has ANALYSIS_MD context token", () => {
    const content = readSourceFile("src/config/gates/analyze.md");

    // The gate must reference ANALYSIS_MD in its frontmatter context section
    expect(content).toContain("ANALYSIS_MD");
  });

  test("7. analyze gate has REMEDIATION_COMPLETE response", () => {
    const content = readSourceFile("src/config/gates/analyze.md");

    expect(content).toContain("REMEDIATION_COMPLETE");
  });

  test("8. analyze gate has ESCALATION response", () => {
    const content = readSourceFile("src/config/gates/analyze.md");

    expect(content).toContain("ESCALATION");
  });

  test("9. analyze gate prohibits independent artifact review", () => {
    const content = readSourceFile("src/config/gates/analyze.md");

    // The gate must contain the instruction preventing the orchestrator
    // from substituting its own review for the analyze agent's report
    expect(content).toContain("Do NOT substitute");
  });
});

// ===========================================================================
// collab.run-tests.md command file tests (3 tests)
// ===========================================================================

describe("collab.run-tests.md command file", () => {
  test("19. collab.run-tests.md exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/commands/collab.run-tests.md");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("20. collab.run-tests.md contains all three signal names", () => {
    const content = readSourceFile("src/commands/collab.run-tests.md");

    expect(content).toContain("RUN_TESTS_COMPLETE");
    expect(content).toContain("RUN_TESTS_FAILED");
    expect(content).toContain("RUN_TESTS_ERROR");
  });

  test("21. collab.run-tests.md uses correct signal format", () => {
    const content = readSourceFile("src/commands/collab.run-tests.md");

    // Must reference the SIGNAL format used by pipeline-signal.ts
    expect(content).toContain("[SIGNAL:TICKET_ID:NONCE]");
  });
});

// ===========================================================================
// collab.visual-verify.md command file tests (3 tests)
// ===========================================================================

describe("collab.visual-verify.md command file", () => {
  test("22. collab.visual-verify.md exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/commands/collab.visual-verify.md");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("23. collab.visual-verify.md contains all three signal names", () => {
    const content = readSourceFile("src/commands/collab.visual-verify.md");

    expect(content).toContain("VISUAL_VERIFY_COMPLETE");
    expect(content).toContain("VISUAL_VERIFY_FAILED");
    expect(content).toContain("VISUAL_VERIFY_ERROR");
  });

  test("24. collab.visual-verify.md uses correct signal format", () => {
    const content = readSourceFile("src/commands/collab.visual-verify.md");

    expect(content).toContain("[SIGNAL:TICKET_ID:NONCE]");
  });
});

// ===========================================================================
// pipeline.json visual_verify phase tests (2 tests)
// ===========================================================================

describe("pipeline.json visual_verify phase", () => {
  test("25. pipeline.json visual_verify phase has correct signals", () => {
    const pipeline = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".collab/config/pipeline.json"), "utf-8"));
    const vv = pipeline.phases["visual_verify"];

    expect(vv).toBeDefined();
    expect(vv.signals).toContain("VISUAL_VERIFY_COMPLETE");
    expect(vv.signals).toContain("VISUAL_VERIFY_FAILED");
    expect(vv.signals).toContain("VISUAL_VERIFY_ERROR");
    expect(vv.signals.length).toBe(3);
  });

  test("26. pipeline.json visual_verify transitions route correctly", () => {
    const pipeline = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".collab/config/pipeline.json"), "utf-8"));
    const vv = pipeline.phases["visual_verify"];

    expect(vv.transitions.VISUAL_VERIFY_COMPLETE.to).toBe("blindqa");
    expect(vv.transitions.VISUAL_VERIFY_FAILED.to).toBe("visual_verify");
    expect(vv.transitions.VISUAL_VERIFY_ERROR.to).toBe("visual_verify");
  });
});

// ===========================================================================
// CLAUDE.md depth override tests (3 tests)
// ===========================================================================

describe("CLAUDE.md PAI depth override for pipeline messages", () => {
  test("14. CLAUDE.md overrides depth for [SIGNAL:] messages", () => {
    const content = readSourceFile("CLAUDE.md");

    // CLAUDE.md must contain the depth override instruction for SIGNAL messages
    expect(content).toContain("[SIGNAL:");
    expect(content).toContain("FULL depth");
  });

  test("15. CLAUDE.md overrides depth for [CMD:] messages", () => {
    const content = readSourceFile("CLAUDE.md");

    expect(content).toContain("[CMD:");
  });

  test("16. CLAUDE.md states MINIMAL classification is incorrect for pipeline messages", () => {
    const content = readSourceFile("CLAUDE.md");

    // Must explicitly tell the orchestrator to ignore MINIMAL classification
    // when it receives pipeline signals/commands
    expect(content).toContain("MINIMAL");
    expect(content).toContain("Ignore it");
  });
});

// ===========================================================================
// pipeline variant routing tests (3 tests)
// ===========================================================================

describe("pipeline variant routing instructions", () => {
  test("27. collab.specify.md has pipeline variant detection step", () => {
    const content = readSourceFile("src/commands/collab.specify.md");

    expect(content).toContain("pipeline:");
    expect(content).toContain("pipeline_variant");
  });

  test("28. collab.specify.md instructs updating metadata.json with pipeline_variant", () => {
    const content = readSourceFile("src/commands/collab.specify.md");

    expect(content).toContain("metadata.json");
    expect(content).toContain("pipeline_variant");
    expect(content).toContain("pipeline-variants");
  });

  test("29. orchestrator-init.ts reads pipeline_variant from metadata", () => {
    const content = readSourceFile("src/scripts/orchestrator/commands/orchestrator-init.ts");

    expect(content).toContain("pipeline_variant");
    expect(content).toContain("pipeline-variants");
    expect(content).toContain("pipelineVariant");
  });
});

// ===========================================================================
// pipeline.json structure tests (4 tests)
// ===========================================================================

describe("pipeline.json structure", () => {
  let pipeline: any;

  const pipelinePath = path.join(REPO_ROOT, ".collab/config/pipeline.json");

  test("10. pipeline.json has correct version", () => {
    pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));
    expect(pipeline.version).toBe("3.1");
  });

  test("11. pipeline.json has all 9 phases", () => {
    pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));
    const phaseIds = Object.keys(pipeline.phases);

    expect(phaseIds).toContain("clarify");
    expect(phaseIds).toContain("plan");
    expect(phaseIds).toContain("tasks");
    expect(phaseIds).toContain("analyze");
    expect(phaseIds).toContain("implement");
    expect(phaseIds).toContain("run_tests");
    expect(phaseIds).toContain("visual_verify");
    expect(phaseIds).toContain("blindqa");
    expect(phaseIds).toContain("done");
    expect(phaseIds.length).toBe(9);
  });

  test("12. blindqa phase has goal_gate always", () => {
    pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));
    const blindqa = pipeline.phases["blindqa"];

    expect(blindqa).toBeDefined();
    expect(blindqa.goal_gate).toBe("always");
  });

  test("13. analyze_review gate has ESCALATION without to field (retry loop)", () => {
    pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));
    const analyzeGate = pipeline.gates?.analyze_review;

    expect(analyzeGate).toBeDefined();
    expect(analyzeGate.on).toBeDefined();
    expect(analyzeGate.on.ESCALATION).toBeDefined();

    // ESCALATION should have feedback:"raw" and NO "to" field (meaning retry)
    const escalation = analyzeGate.on.ESCALATION;
    expect(escalation.feedback).toBe("raw");
    expect(escalation.to).toBeUndefined();
  });

  test("17. pipeline.json run_tests phase has correct signals", () => {
    pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));
    const runTests = pipeline.phases["run_tests"];

    expect(runTests).toBeDefined();
    expect(runTests.signals).toContain("RUN_TESTS_COMPLETE");
    expect(runTests.signals).toContain("RUN_TESTS_FAILED");
    expect(runTests.signals).toContain("RUN_TESTS_ERROR");
    expect(runTests.signals.length).toBe(3);
  });

  test("18. pipeline.json run_tests transitions route correctly", () => {
    pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));
    const runTests = pipeline.phases["run_tests"];

    expect(runTests.transitions.RUN_TESTS_COMPLETE.to).toBe("visual_verify");
    expect(runTests.transitions.RUN_TESTS_FAILED.to).toBe("run_tests");
    expect(runTests.transitions.RUN_TESTS_ERROR.to).toBe("run_tests");
  });
});

// ===========================================================================
// backend variant config tests (6 tests)
// ===========================================================================

describe("pipeline-variants/backend.json structure", () => {
  const variantPath = path.join(REPO_ROOT, ".collab/config/pipeline-variants/backend.json");

  test("30. backend.json exists", () => {
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  test("31. backend.json version is 3.1", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.version).toBe("3.1");
  });

  test("32. all to: targets reference phases that exist", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseNames = new Set(Object.keys(variant.phases));

    for (const [phaseName, phase] of Object.entries(variant.phases) as [string, any][]) {
      if (phase.terminal) continue;
      for (const [signal, transition] of Object.entries(phase.transitions ?? {}) as [string, any][]) {
        expect(
          phaseNames.has(transition.to),
          `Phase '${phaseName}' signal '${signal}' targets '${transition.to}' which does not exist`
        ).toBe(true);
      }
    }
  });

  test("33. done phase has terminal: true", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.phases.done.terminal).toBe(true);
  });

  test("34. spec_critique is between clarify and plan", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    const clarifyIdx = phaseIds.indexOf("clarify");
    const specCritiqueIdx = phaseIds.indexOf("spec_critique");
    const planIdx = phaseIds.indexOf("plan");

    expect(clarifyIdx).toBeGreaterThanOrEqual(0);
    expect(specCritiqueIdx).toBeGreaterThan(clarifyIdx);
    expect(planIdx).toBeGreaterThan(specCritiqueIdx);

    // Verify routing: clarify → spec_critique → plan
    expect(variant.phases.clarify.transitions.CLARIFY_COMPLETE.to).toBe("spec_critique");
    expect(variant.phases.spec_critique.transitions.SPEC_CRITIQUE_COMPLETE.to).toBe("plan");
  });

  test("35. run_tests is between codeReview and blindqa", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    const codeReviewIdx = phaseIds.indexOf("codeReview");
    const runTestsIdx = phaseIds.indexOf("run_tests");
    const blindqaIdx = phaseIds.indexOf("blindqa");

    expect(codeReviewIdx).toBeGreaterThanOrEqual(0);
    expect(runTestsIdx).toBeGreaterThan(codeReviewIdx);
    expect(blindqaIdx).toBeGreaterThan(runTestsIdx);

    // Verify routing: codeReview → run_tests → blindqa
    expect(variant.phases.codeReview.transitions.CODE_REVIEW_PASS.to).toBe("run_tests");
    expect(variant.phases.run_tests.transitions.RUN_TESTS_COMPLETE.to).toBe("blindqa");
  });
});

// ===========================================================================
// frontend-ui variant config tests (6 tests)
// ===========================================================================

describe("pipeline-variants/frontend-ui.json structure", () => {
  const variantPath = path.join(REPO_ROOT, ".collab/config/pipeline-variants/frontend-ui.json");

  test("36. frontend-ui.json exists", () => {
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  test("37. frontend-ui.json version is 3.1", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.version).toBe("3.1");
  });

  test("38. all to: targets reference phases that exist", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseNames = new Set(Object.keys(variant.phases));

    for (const [phaseName, phase] of Object.entries(variant.phases) as [string, any][]) {
      if (phase.terminal) continue;
      for (const [signal, transition] of Object.entries(phase.transitions ?? {}) as [string, any][]) {
        expect(
          phaseNames.has(transition.to),
          `Phase '${phaseName}' signal '${signal}' targets '${transition.to}' which does not exist`
        ).toBe(true);
      }
    }
  });

  test("39. done phase has terminal: true", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.phases.done.terminal).toBe(true);
  });

  test("40. run_tests is before visual_verify", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    const runTestsIdx = phaseIds.indexOf("run_tests");
    const visualVerifyIdx = phaseIds.indexOf("visual_verify");

    expect(runTestsIdx).toBeGreaterThanOrEqual(0);
    expect(visualVerifyIdx).toBeGreaterThan(runTestsIdx);

    // Verify routing: run_tests → visual_verify
    expect(variant.phases.run_tests.transitions.RUN_TESTS_COMPLETE.to).toBe("visual_verify");
  });

  test("41. visual_verify is before blindqa", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    const visualVerifyIdx = phaseIds.indexOf("visual_verify");
    const blindqaIdx = phaseIds.indexOf("blindqa");

    expect(visualVerifyIdx).toBeGreaterThanOrEqual(0);
    expect(blindqaIdx).toBeGreaterThan(visualVerifyIdx);

    // Verify routing: visual_verify → blindqa
    expect(variant.phases.visual_verify.transitions.VISUAL_VERIFY_COMPLETE.to).toBe("blindqa");
  });
});

// ===========================================================================
// verification variant config tests (6 tests)
// ===========================================================================

describe("pipeline-variants/verification.json structure", () => {
  const variantPath = path.join(REPO_ROOT, ".collab/config/pipeline-variants/verification.json");

  test("42. verification.json exists", () => {
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  test("43. verification.json version is 3.1", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.version).toBe("3.1");
  });

  test("44. all to: targets reference phases that exist", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseNames = new Set(Object.keys(variant.phases));

    for (const [phaseName, phase] of Object.entries(variant.phases) as [string, any][]) {
      if (phase.terminal) continue;
      for (const [signal, transition] of Object.entries(phase.transitions ?? {}) as [string, any][]) {
        expect(
          phaseNames.has(transition.to),
          `Phase '${phaseName}' signal '${signal}' targets '${transition.to}' which does not exist`
        ).toBe(true);
      }
    }
  });

  test("45. done and escalate are both terminal", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.phases.done.terminal).toBe(true);
    expect(variant.phases.escalate.terminal).toBe(true);
  });

  test("46. verify_execute is between clarify and done", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    const clarifyIdx = phaseIds.indexOf("clarify");
    const verifyIdx = phaseIds.indexOf("verify_execute");
    const doneIdx = phaseIds.indexOf("done");

    expect(clarifyIdx).toBeGreaterThanOrEqual(0);
    expect(verifyIdx).toBeGreaterThan(clarifyIdx);
    expect(doneIdx).toBeGreaterThan(verifyIdx);

    // Verify routing: clarify → verify_execute → done
    expect(variant.phases.clarify.transitions.CLARIFY_COMPLETE.to).toBe("verify_execute");
    expect(variant.phases.verify_execute.transitions.VERIFY_EXECUTE_COMPLETE.to).toBe("done");
  });

  test("47. only 2 non-terminal phases (clarify, verify_execute)", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const nonTerminal = Object.entries(variant.phases).filter(
      ([, phase]: [string, any]) => !phase.terminal
    );
    expect(nonTerminal.length).toBe(2);
    expect(nonTerminal.map(([name]) => name)).toEqual(["clarify", "verify_execute"]);
  });
});

// ===========================================================================
// collab.verify-execute.md command file tests (3 tests)
// ===========================================================================

describe("collab.verify-execute.md command file", () => {
  test("48. collab.verify-execute.md exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/commands/collab.verify-execute.md");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("49. collab.verify-execute.md contains all three signal names", () => {
    const content = readSourceFile("src/commands/collab.verify-execute.md");

    expect(content).toContain("VERIFY_EXECUTE_COMPLETE");
    expect(content).toContain("VERIFY_EXECUTE_FAILED");
    expect(content).toContain("VERIFY_EXECUTE_ERROR");
  });

  test("50. collab.verify-execute.md uses correct signal format", () => {
    const content = readSourceFile("src/commands/collab.verify-execute.md");

    expect(content).toContain("[SIGNAL:TICKET_ID:NONCE]");
  });
});

// ===========================================================================
// emit-verify-execute-signal.ts handler tests (2 tests)
// ===========================================================================

describe("emit-verify-execute-signal.ts handler", () => {
  test("51. emit-verify-execute-signal.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/handlers/emit-verify-execute-signal.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("52. emit-verify-execute-signal.ts uses emitPhaseSignal factory", () => {
    const content = readSourceFile("src/handlers/emit-verify-execute-signal.ts");

    expect(content).toContain('emitPhaseSignal("verify_execute"');
    expect(content).toContain("emit-phase-signal");
  });
});

// ===========================================================================
// verify-execute-executor.ts static tests (2 tests)
// ===========================================================================

describe("verify-execute-executor.ts file", () => {
  test("72. verify-execute-executor.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/scripts/verify-execute-executor.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("73. verify-execute-executor.ts uses getRepoRoot pattern", () => {
    const content = readSourceFile("src/scripts/verify-execute-executor.ts");
    expect(content).toContain("getRepoRoot");
    expect(content).toContain("git rev-parse --show-toplevel");
  });
});

// ===========================================================================
// collab.pre-deploy-confirm.md command file tests (3 tests)
// ===========================================================================

describe("collab.pre-deploy-confirm.md command file", () => {
  test("53. collab.pre-deploy-confirm.md exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/commands/collab.pre-deploy-confirm.md");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("54. collab.pre-deploy-confirm.md contains all three signal names", () => {
    const content = readSourceFile("src/commands/collab.pre-deploy-confirm.md");

    expect(content).toContain("PRE_DEPLOY_CONFIRM_COMPLETE");
    expect(content).toContain("PRE_DEPLOY_CONFIRM_FAILED");
    expect(content).toContain("PRE_DEPLOY_CONFIRM_ERROR");
  });

  test("55. collab.pre-deploy-confirm.md uses correct signal format", () => {
    const content = readSourceFile("src/commands/collab.pre-deploy-confirm.md");

    expect(content).toContain("[SIGNAL:TICKET_ID:NONCE]");
  });
});

// ===========================================================================
// emit-pre-deploy-confirm-signal.ts handler tests (2 tests)
// ===========================================================================

describe("emit-pre-deploy-confirm-signal.ts handler", () => {
  test("56. emit-pre-deploy-confirm-signal.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/handlers/emit-pre-deploy-confirm-signal.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("57. emit-pre-deploy-confirm-signal.ts uses emitPhaseSignal factory", () => {
    const content = readSourceFile("src/handlers/emit-pre-deploy-confirm-signal.ts");

    expect(content).toContain('emitPhaseSignal("pre_deploy_confirm"');
    expect(content).toContain("emit-phase-signal");
  });
});

// ===========================================================================
// collab.deploy-verify.md command file tests (3 tests)
// ===========================================================================

describe("collab.deploy-verify.md command file", () => {
  test("58. collab.deploy-verify.md exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/commands/collab.deploy-verify.md");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("59. collab.deploy-verify.md contains all three signal names", () => {
    const content = readSourceFile("src/commands/collab.deploy-verify.md");

    expect(content).toContain("DEPLOY_VERIFY_COMPLETE");
    expect(content).toContain("DEPLOY_VERIFY_FAILED");
    expect(content).toContain("DEPLOY_VERIFY_ERROR");
  });

  test("60. collab.deploy-verify.md uses correct signal format", () => {
    const content = readSourceFile("src/commands/collab.deploy-verify.md");

    expect(content).toContain("[SIGNAL:TICKET_ID:NONCE]");
  });
});

// ===========================================================================
// emit-deploy-verify-signal.ts handler tests (2 tests)
// ===========================================================================

describe("emit-deploy-verify-signal.ts handler", () => {
  test("61. emit-deploy-verify-signal.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/handlers/emit-deploy-verify-signal.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("62. emit-deploy-verify-signal.ts uses emitPhaseSignal factory", () => {
    const content = readSourceFile("src/handlers/emit-deploy-verify-signal.ts");

    expect(content).toContain('emitPhaseSignal("deploy_verify"');
    expect(content).toContain("emit-phase-signal");
  });
});

// ===========================================================================
// deploy-verify-executor.ts static tests (2 tests)
// ===========================================================================

describe("deploy-verify-executor.ts file", () => {
  test("70. deploy-verify-executor.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/scripts/deploy-verify-executor.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("71. deploy-verify-executor.ts uses getRepoRoot pattern", () => {
    const content = readSourceFile("src/scripts/deploy-verify-executor.ts");
    expect(content).toContain("getRepoRoot");
    expect(content).toContain("git rev-parse --show-toplevel");
  });
});

// ===========================================================================
// pre-deploy-summary.ts static tests (1 test)
// ===========================================================================

describe("pre-deploy-summary.ts file", () => {
  test("74. pre-deploy-summary.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/scripts/pre-deploy-summary.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("75. pre-deploy-summary.ts uses getRepoRoot pattern", () => {
    const content = readSourceFile("src/scripts/pre-deploy-summary.ts");
    expect(content).toContain("getRepoRoot");
    expect(content).toContain("git rev-parse --show-toplevel");
  });
});

// ===========================================================================
// collab.pre-deploy-confirm.md executor wiring test (1 test)
// ===========================================================================

describe("collab.pre-deploy-confirm.md executor wiring", () => {
  test("76. command references pre-deploy-summary.ts call path", () => {
    const content = readSourceFile("src/commands/collab.pre-deploy-confirm.md");
    expect(content).toContain("bun .collab/scripts/pre-deploy-summary.ts");
  });
});

// ===========================================================================
// deploy variant config tests (7 tests)
// ===========================================================================

describe("pipeline-variants/deploy.json structure", () => {
  const variantPath = path.join(REPO_ROOT, ".collab/config/pipeline-variants/deploy.json");

  test("63. deploy.json exists", () => {
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  test("64. deploy.json version is 3.1", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.version).toBe("3.1");
  });

  test("65. all to: targets reference phases that exist", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseNames = new Set(Object.keys(variant.phases));

    for (const [phaseName, phase] of Object.entries(variant.phases) as [string, any][]) {
      if (phase.terminal) continue;
      for (const [signal, transition] of Object.entries(phase.transitions ?? {}) as [string, any][]) {
        expect(
          phaseNames.has(transition.to),
          `Phase '${phaseName}' signal '${signal}' targets '${transition.to}' which does not exist`
        ).toBe(true);
      }
    }
  });

  test("66. done and escalate are both terminal", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    expect(variant.phases.done.terminal).toBe(true);
    expect(variant.phases.escalate.terminal).toBe(true);
  });

  test("67. pre_deploy_confirm is between blindqa and deploy_verify", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    const blindqaIdx = phaseIds.indexOf("blindqa");
    const preDeployIdx = phaseIds.indexOf("pre_deploy_confirm");
    const deployVerifyIdx = phaseIds.indexOf("deploy_verify");

    expect(blindqaIdx).toBeGreaterThanOrEqual(0);
    expect(preDeployIdx).toBeGreaterThan(blindqaIdx);
    expect(deployVerifyIdx).toBeGreaterThan(preDeployIdx);

    // Verify routing: blindqa → pre_deploy_confirm → deploy_verify
    expect(variant.phases.blindqa.transitions.BLINDQA_COMPLETE.to).toBe("pre_deploy_confirm");
    expect(variant.phases.pre_deploy_confirm.transitions.PRE_DEPLOY_CONFIRM_COMPLETE.to).toBe("deploy_verify");
  });

  test("68. deploy_human_gate has all 3 decision signals", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const gate = variant.phases.deploy_human_gate;

    expect(gate).toBeDefined();
    expect(gate.signals).toContain("DEPLOY_FIX_FORWARD");
    expect(gate.signals).toContain("DEPLOY_ROLLBACK");
    expect(gate.signals).toContain("DEPLOY_INVESTIGATE");
    expect(gate.signals.length).toBe(3);

    // FIX_FORWARD loops back to implement; ROLLBACK and INVESTIGATE escalate
    expect(gate.transitions.DEPLOY_FIX_FORWARD.to).toBe("implement");
    expect(gate.transitions.DEPLOY_ROLLBACK.to).toBe("escalate");
    expect(gate.transitions.DEPLOY_INVESTIGATE.to).toBe("escalate");
  });

  test("69. deploy variant has no visual_verify phase", () => {
    const variant = JSON.parse(fs.readFileSync(variantPath, "utf-8"));
    const phaseIds = Object.keys(variant.phases);

    expect(phaseIds).not.toContain("visual_verify");
  });
});

// ===========================================================================
// emit-code-review-signal.ts handler tests (2 tests)
// ===========================================================================

describe("emit-code-review-signal.ts handler", () => {
  test("83. emit-code-review-signal.ts exists", () => {
    const fullPath = path.join(REPO_ROOT, "src/handlers/emit-code-review-signal.ts");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("84. collab.codeReview.md references emit-code-review-signal.ts", () => {
    const content = readSourceFile("src/commands/collab.codeReview.md");
    expect(content).toContain("emit-code-review-signal.ts");
  });
});

// ===========================================================================
// collab.install.ts installer tests (6 tests)
// ===========================================================================

describe("collab.install.ts installer updates", () => {
  test("77. collab.install.ts contains pipeline-variants copy section", () => {
    const content = readSourceFile("src/commands/collab.install.ts");
    expect(content).toContain("pipeline-variants");
    expect(content).toContain("variantsDir");
  });

  test("78. collab.install.ts contains command config scaffold section", () => {
    const content = readSourceFile("src/commands/collab.install.ts");
    expect(content).toContain("commandConfigs");
    expect(content).toContain("configScaffoldCount");
    expect(content).toContain("scaffold");
  });

  test("79. src/config/defaults/run-tests.json exists and is valid JSON", () => {
    const fullPath = path.join(REPO_ROOT, "src/config/defaults/run-tests.json");
    expect(fs.existsSync(fullPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    expect(content.command).toBe("npm test");
    expect(content.timeout).toBe(120);
  });

  test("80. src/config/defaults/visual-verify.json exists and is valid JSON", () => {
    const fullPath = path.join(REPO_ROOT, "src/config/defaults/visual-verify.json");
    expect(fs.existsSync(fullPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    expect(content.baseUrl).toBe("http://localhost:3000");
    expect(content.routes).toBeArray();
  });

  test("81. src/config/defaults/deploy-verify.json exists and is valid JSON", () => {
    const fullPath = path.join(REPO_ROOT, "src/config/defaults/deploy-verify.json");
    expect(fs.existsSync(fullPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    expect(content.productionUrl).toBe("https://your-app.example.com");
    expect(content.smokeRoutes).toEqual(["/"]);
  });

  test("82. collab.install.ts lists all 5 new commands in Available Commands", () => {
    const content = readSourceFile("src/commands/collab.install.ts");
    expect(content).toContain("/collab.run-tests");
    expect(content).toContain("/collab.visual-verify");
    expect(content).toContain("/collab.verify-execute");
    expect(content).toContain("/collab.pre-deploy-confirm");
    expect(content).toContain("/collab.deploy-verify");
  });
});
