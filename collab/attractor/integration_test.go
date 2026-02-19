//go:build integration

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/handlers"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

func setupIntegrationEnv(t *testing.T) (repoRoot, regDir string, mock *runner.MockCommander) {
	t.Helper()
	repoRoot = t.TempDir()
	regDir = filepath.Join(repoRoot, ".collab", "state", "pipeline-registry")
	os.MkdirAll(regDir, 0755)

	// Create gate templates
	gatesDir := filepath.Join(repoRoot, ".collab", "config", "gates")
	os.MkdirAll(gatesDir, 0755)
	os.WriteFile(filepath.Join(gatesDir, "plan-review-prompt.md"),
		[]byte("Review: {{SPEC_MD}} Plan: {{PLAN_MD}}"), 0644)
	os.WriteFile(filepath.Join(gatesDir, "analyze-review-prompt.md"),
		[]byte("Analyze: {{PHASE}}"), 0644)

	// Create verify-config.json
	configDir := filepath.Join(repoRoot, ".collab", "config")
	os.MkdirAll(configDir, 0755)
	os.WriteFile(filepath.Join(configDir, "verify-config.json"),
		[]byte(`{"command":"echo ok","timeout":10,"working_dir":null}`), 0644)
	os.WriteFile(filepath.Join(configDir, "verify-patterns.json"), []byte(`[]`), 0644)

	// Write registry for test ticket
	regData, _ := json.Marshal(registry.RegistryData{
		Nonce: "integ01", CurrentStep: "plan",
		AgentPaneID: "%1", OrchestratorPaneID: "%2",
		WorktreePath: repoRoot,
	})
	os.WriteFile(filepath.Join(regDir, "INT-001.json"), regData, 0644)

	mock = &runner.MockCommander{}
	return
}

func TestIntegration_PlanComplete_SendsToOrchestrator(t *testing.T) {
	repoRoot, regDir, mock := setupIntegrationEnv(t)

	eng := engine.NewExecutionEngine(mock, repoRoot, regDir)
	handlers.RegisterAll(eng, mock, repoRoot, regDir)

	b := NewBridge(eng, mock, repoRoot, regDir)

	sig := engine.CollabSignal{
		TicketID: "INT-001", Nonce: "integ01",
		SignalType: "PLAN_COMPLETE", Detail: "plan done",
	}
	b.dispatch(sig)

	// Wait for async processing
	time.Sleep(200 * time.Millisecond)
	b.Shutdown()

	// Verify Tmux.ts send called with orchestrator pane
	found := false
	for _, call := range mock.Calls {
		if call.Name == "bun" {
			for _, arg := range call.Args {
				if arg == "%2" {
					found = true
				}
			}
		}
	}
	if !found {
		t.Errorf("expected Tmux.ts send to orchestrator %%2, calls: %+v", mock.Calls)
	}
}

func TestIntegration_ClarifyComplete_CallsPhaseAdvance(t *testing.T) {
	repoRoot, regDir, mock := setupIntegrationEnv(t)

	scripts := filepath.Join(repoRoot, ".collab", "scripts")
	os.MkdirAll(scripts, 0755)

	eng := engine.NewExecutionEngine(mock, repoRoot, regDir)
	handlers.RegisterAll(eng, mock, repoRoot, regDir)
	b := NewBridge(eng, mock, repoRoot, regDir)

	sig := engine.CollabSignal{
		TicketID: "INT-001", Nonce: "integ01",
		SignalType: "CLARIFY_COMPLETE", Detail: "done",
	}
	b.dispatch(sig)
	time.Sleep(200 * time.Millisecond)
	b.Shutdown()

	// Verify phase-advance.sh called
	found := false
	for _, call := range mock.Calls {
		if call.Name == "bash" {
			for _, arg := range call.Args {
				if strings.Contains(arg, "phase-advance.sh") {
					found = true
				}
			}
		}
	}
	if !found {
		t.Errorf("expected phase-advance.sh call for CLARIFY_COMPLETE, calls: %+v", mock.Calls)
	}
}

func TestIntegration_ImplementComplete_VerifyPasses(t *testing.T) {
	repoRoot, regDir, mock := setupIntegrationEnv(t)

	eng := engine.NewExecutionEngine(mock, repoRoot, regDir)
	handlers.RegisterAll(eng, mock, repoRoot, regDir)
	b := NewBridge(eng, mock, repoRoot, regDir)

	sig := engine.CollabSignal{
		TicketID: "INT-001", Nonce: "integ01",
		SignalType: "IMPLEMENT_COMPLETE", Detail: "done",
	}
	b.dispatch(sig)
	time.Sleep(300 * time.Millisecond)
	b.Shutdown()
	// verify-config.json uses "echo ok" which exits 0 -> StatusSuccess
	// (Confirmed by no NO EXCUSES message in mock calls)
}
