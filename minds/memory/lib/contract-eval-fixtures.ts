/**
 * contract-eval-fixtures.ts — Synthetic contract patterns for consolidation algorithm evaluation.
 *
 * 4 groups: unimodal (12), bimodal (14), noisy (8), sparse (3) = 37 total patterns.
 * Each group tests a specific consolidation challenge.
 */

import type { ContractPattern, SectionDescriptor } from "./contract-types.js";

function makeSection(name: string, required: boolean = true): SectionDescriptor {
  return { name, required, description: `${name} section content` };
}

function makePattern(
  sourcePhase: string,
  targetPhase: string,
  sections: SectionDescriptor[],
  artifactShape: string,
  dayOffset: number = 0,
  metadata: Record<string, string> = {},
): ContractPattern {
  const date = new Date(2026, 0, 1 + dayOffset);
  return {
    sourcePhase,
    targetPhase,
    artifactShape,
    sections,
    metadata: { domain: "pipeline", ...metadata },
    timestamp: date.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Group 1: Unimodal — clarify -> plan (12 patterns)
// Always: Summary, Acceptance Criteria, Tech Stack
// ~80%: Timeline (10/12)
// ~70%: Stakeholders (8/12)
// Noise: 1 pattern missing Tech Stack, 1 pattern with extra "Risks" section
// ---------------------------------------------------------------------------
export const unimodalPatterns: ContractPattern[] = (() => {
  const patterns: ContractPattern[] = [];
  const baseShape = "Spec with Summary, AC, and Tech Stack";

  for (let i = 0; i < 12; i++) {
    const sections: SectionDescriptor[] = [
      makeSection("Summary"),
      makeSection("Acceptance Criteria"),
    ];

    // Tech Stack: present in 11/12 (skip index 7 for noise)
    if (i !== 7) {
      sections.push(makeSection("Tech Stack"));
    }

    // Timeline: present in 10/12 (skip index 4, 9)
    if (i !== 4 && i !== 9) {
      sections.push(makeSection("Timeline", false));
    }

    // Stakeholders: present in 8/12 (skip index 1, 3, 6, 10)
    if (i !== 1 && i !== 3 && i !== 6 && i !== 10) {
      sections.push(makeSection("Stakeholders", false));
    }

    // Noise: extra section on pattern 11
    if (i === 11) {
      sections.push(makeSection("Risks", false));
    }

    const shape = i === 2 ? "Spec document with Summary and AC sections" : baseShape;
    patterns.push(makePattern("clarify", "plan", sections, shape, i));
  }
  return patterns;
})();

// ---------------------------------------------------------------------------
// Group 2: Bimodal — plan -> implement (14 patterns)
// Shape A (backend, 7 patterns): API Design, Database Schema, Auth Requirements, Error Handling
// Shape B (frontend, 7 patterns): Component Tree, State Management, UI Mockups, Routing
// 2 hybrid patterns (index 6 backend, index 13 frontend) mix sections from both
// ---------------------------------------------------------------------------
export const bimodalPatterns: ContractPattern[] = (() => {
  const patterns: ContractPattern[] = [];

  const backendSections = ["API Design", "Database Schema", "Auth Requirements", "Error Handling"];
  const frontendSections = ["Component Tree", "State Management", "UI Mockups", "Routing"];

  // 7 backend patterns
  for (let i = 0; i < 7; i++) {
    const sections = backendSections.map((s) => makeSection(s));
    // Hybrid: pattern 6 adds 2 frontend sections
    if (i === 6) {
      sections.push(makeSection("Component Tree"));
      sections.push(makeSection("State Management"));
    }
    const shape = i === 6 ? "Full-stack implementation plan" : "Backend implementation plan";
    patterns.push(
      makePattern("plan", "implement", sections, shape, 20 + i, {
        variant: i === 6 ? "hybrid" : "backend",
      }),
    );
  }

  // 7 frontend patterns
  for (let i = 0; i < 7; i++) {
    const sections = frontendSections.map((s) => makeSection(s));
    // Hybrid: pattern 6 (index 13) adds 2 backend sections
    if (i === 6) {
      sections.push(makeSection("API Design"));
      sections.push(makeSection("Database Schema"));
    }
    const shape = i === 6 ? "Full-stack implementation plan" : "Frontend implementation plan";
    patterns.push(
      makePattern("plan", "implement", sections, shape, 30 + i, {
        variant: i === 6 ? "hybrid" : "frontend",
      }),
    );
  }

  return patterns;
})();

// ---------------------------------------------------------------------------
// Group 3: Noisy — implement -> review (8 patterns)
// High variance: each pattern has a different random mix of sections
// Some overlap but mostly unique combinations
// ---------------------------------------------------------------------------
export const noisyPatterns: ContractPattern[] = (() => {
  const allSections = [
    "Code Coverage",
    "Lint Results",
    "Performance Metrics",
    "Security Audit",
    "Accessibility Check",
    "Documentation",
    "Migration Notes",
    "Breaking Changes",
    "Dependencies Updated",
    "Test Results",
    "Browser Compatibility",
    "API Changelog",
  ];

  const sectionSets = [
    ["Code Coverage", "Lint Results", "Test Results"],
    ["Performance Metrics", "Security Audit", "Breaking Changes"],
    ["Documentation", "Migration Notes", "API Changelog"],
    ["Accessibility Check", "Browser Compatibility", "Code Coverage"],
    ["Security Audit", "Dependencies Updated", "Test Results", "Lint Results"],
    ["Performance Metrics", "Documentation", "Migration Notes", "Breaking Changes"],
    ["Code Coverage", "Accessibility Check", "API Changelog"],
    ["Lint Results", "Security Audit", "Dependencies Updated", "Browser Compatibility"],
  ];

  return sectionSets.map((names, i) =>
    makePattern(
      "implement",
      "review",
      names.map((n) => makeSection(n, Math.random() > 0.5)),
      `Review artifact variant ${i + 1}`,
      40 + i,
      { noise: "high" },
    ),
  );
})();

// ---------------------------------------------------------------------------
// Group 4: Sparse — review -> deploy (3 patterns)
// Cold-start test: only 2-3 patterns, consistent sections
// ---------------------------------------------------------------------------
export const sparsePatterns: ContractPattern[] = [
  makePattern(
    "review",
    "deploy",
    [makeSection("Deployment Checklist"), makeSection("Rollback Plan")],
    "Deployment readiness artifact",
    50,
  ),
  makePattern(
    "review",
    "deploy",
    [makeSection("Deployment Checklist"), makeSection("Rollback Plan"), makeSection("Release Notes", false)],
    "Deployment readiness artifact",
    51,
  ),
  makePattern(
    "review",
    "deploy",
    [makeSection("Deployment Checklist"), makeSection("Rollback Plan")],
    "Deployment readiness artifact",
    52,
  ),
];

/** All fixtures combined. */
export const allFixtures: ContractPattern[] = [
  ...unimodalPatterns,
  ...bimodalPatterns,
  ...noisyPatterns,
  ...sparsePatterns,
];
