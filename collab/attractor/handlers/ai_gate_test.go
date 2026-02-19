package handlers_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/handlers"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

func writeReg(t *testing.T, dir, ticketID string, reg registry.RegistryData) {
	t.Helper()
	data, _ := json.Marshal(reg)
	os.WriteFile(filepath.Join(dir, ticketID+".json"), data, 0644)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0755)
	os.WriteFile(path, []byte(content), 0644)
}

func TestAIGateHandler_PlanComplete_SendsPromptToOrchestrator(t *testing.T) {
	repoRoot := t.TempDir()
	regDir := t.TempDir()

	gatesDir := filepath.Join(repoRoot, ".collab", "config", "gates")
	os.MkdirAll(gatesDir, 0755)
	writeFile(t, filepath.Join(gatesDir, "plan-review-prompt.md"),
		"Review: {{SPEC_MD}} --- Plan: {{PLAN_MD}}")

	specsDir := filepath.Join(repoRoot, "specs", "feat-001")
	os.MkdirAll(specsDir, 0755)
	writeFile(t, filepath.Join(specsDir, "spec.md"), "# Spec Content")
	writeFile(t, filepath.Join(specsDir, "plan.md"), "# Plan Content")

	mock := &runner.MockCommander{}
	writeReg(t, regDir, "BRE-1", registry.RegistryData{Nonce: "abc", OrchestratorPaneID: "%10"})

	h := handlers.NewAIGateHandler(mock, repoRoot, regDir)
	ctx := &engine.Context{
		TicketID:           "BRE-1",
		SignalType:         "PLAN_COMPLETE",
		OrchestratorPaneID: "%10",
		WorktreePath:       repoRoot,
	}
	outcome := h.Execute(nil, ctx, nil, "")
	if outcome.Status != engine.StatusSuccess {
		t.Errorf("expected StatusSuccess, got %v (reason: %s)", outcome.Status, outcome.FailureReason)
	}

	// Verify Tmux.ts send was called with orchestrator pane
	found := false
	for _, call := range mock.Calls {
		if call.Name == "bun" {
			for _, arg := range call.Args {
				if arg == "%10" {
					found = true
				}
			}
		}
	}
	if !found {
		t.Errorf("expected Tmux.ts send to %%10, calls: %+v", mock.Calls)
	}

	// Verify prompt contains spec content
	for _, call := range mock.Calls {
		if call.Name == "bun" {
			for _, arg := range call.Args {
				if strings.Contains(arg, "Spec Content") {
					return // found
				}
			}
		}
	}
	t.Error("prompt sent to tmux does not contain spec content")
}

func TestAIGateHandler_MissingTemplate_ReturnsStatusFail(t *testing.T) {
	repoRoot := t.TempDir()
	regDir := t.TempDir()
	writeReg(t, regDir, "BRE-1", registry.RegistryData{Nonce: "abc"})

	// No gate template files written
	mock := &runner.MockCommander{}
	h := handlers.NewAIGateHandler(mock, repoRoot, regDir)
	ctx := &engine.Context{
		TicketID:   "BRE-1",
		SignalType: "PLAN_COMPLETE",
	}
	outcome := h.Execute(nil, ctx, nil, "")
	if outcome.Status != engine.StatusFail {
		t.Errorf("expected StatusFail when template missing, got %v", outcome.Status)
	}
}

func TestAIGateHandler_AnalyzeComplete_Phase1_SetsFlag(t *testing.T) {
	repoRoot := t.TempDir()
	regDir := t.TempDir()

	gatesDir := filepath.Join(repoRoot, ".collab", "config", "gates")
	os.MkdirAll(gatesDir, 0755)
	writeFile(t, filepath.Join(gatesDir, "analyze-review-prompt.md"), "Analyze: {{PHASE}}")

	writeReg(t, regDir, "BRE-2", registry.RegistryData{
		Nonce: "abc", OrchestratorPaneID: "%11", AnalysisRemediationDone: false,
	})

	mock := &runner.MockCommander{}
	h := handlers.NewAIGateHandler(mock, repoRoot, regDir)
	ctx := &engine.Context{
		TicketID:           "BRE-2",
		SignalType:         "ANALYZE_COMPLETE",
		OrchestratorPaneID: "%11",
		WorktreePath:       repoRoot,
	}
	outcome := h.Execute(nil, ctx, nil, "")
	if outcome.Status != engine.StatusSuccess {
		t.Errorf("expected StatusSuccess, got %v: %s", outcome.Status, outcome.FailureReason)
	}

	// Verify registry was updated with analysis_remediation_done=true
	reg, err := registry.ReadRegistry(regDir, "BRE-2")
	if err != nil {
		t.Fatalf("ReadRegistry: %v", err)
	}
	if !reg.AnalysisRemediationDone {
		t.Error("expected analysis_remediation_done=true after Phase 1")
	}
}

func TestAIGateHandler_AnalyzeComplete_Phase2_EscalationPrompt(t *testing.T) {
	repoRoot := t.TempDir()
	regDir := t.TempDir()

	gatesDir := filepath.Join(repoRoot, ".collab", "config", "gates")
	os.MkdirAll(gatesDir, 0755)
	writeFile(t, filepath.Join(gatesDir, "analyze-review-prompt.md"), "Analyze: {{PHASE}}")

	writeReg(t, regDir, "BRE-3", registry.RegistryData{
		Nonce: "abc", OrchestratorPaneID: "%12", AnalysisRemediationDone: true,
	})

	mock := &runner.MockCommander{}
	h := handlers.NewAIGateHandler(mock, repoRoot, regDir)
	ctx := &engine.Context{
		TicketID:           "BRE-3",
		SignalType:         "ANALYZE_COMPLETE",
		OrchestratorPaneID: "%12",
		WorktreePath:       repoRoot,
	}
	outcome := h.Execute(nil, ctx, nil, "")
	if outcome.Status != engine.StatusSuccess {
		t.Errorf("expected StatusSuccess, got %v", outcome.Status)
	}

	// Verify Phase 2 escalation content sent
	for _, call := range mock.Calls {
		if call.Name == "bun" {
			for _, arg := range call.Args {
				if strings.Contains(arg, "ESCALATION") || strings.Contains(arg, "Phase 2") {
					return
				}
			}
		}
	}
	t.Error("expected Phase 2 escalation content in tmux send")
}
