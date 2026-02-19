package engine_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

func writeRegistry(t *testing.T, dir, ticketID string, reg registry.RegistryData) {
	t.Helper()
	data, err := json.Marshal(reg)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ticketID+".json"), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestProcess_PassthroughCallsPhaseAdvance(t *testing.T) {
	tmp := t.TempDir()

	// MockCommander returns (nil, nil) for unmatched stubs — no error, empty output.
	// That means nextPhase will be "" which is fine for verifying call structure.
	mock := &runner.MockCommander{}
	eng := engine.NewExecutionEngine(mock, tmp, tmp)
	eng.RegisterPassthrough("CLARIFY_COMPLETE")

	reg := registry.RegistryData{Nonce: "abc", CurrentStep: "clarify"}
	sig := engine.CollabSignal{TicketID: "BRE-1", Nonce: "abc", SignalType: "CLARIFY_COMPLETE", Detail: "done"}

	if err := eng.Process(sig, &reg); err != nil {
		t.Fatalf("Process() error: %v", err)
	}
	if len(mock.Calls) < 2 {
		t.Fatalf("expected 2 calls (phase-advance.sh + registry-update.sh), got %d", len(mock.Calls))
	}

	// First call: phase-advance.sh with current step (not ticket ID)
	call0 := mock.Calls[0]
	if call0.Name != "bash" {
		t.Errorf("call[0]: expected bash, got %q", call0.Name)
	}
	if !strings.Contains(call0.Args[0], "phase-advance.sh") {
		t.Errorf("call[0]: expected phase-advance.sh, got %v", call0.Args)
	}
	if len(call0.Args) < 2 || call0.Args[1] != "clarify" {
		t.Errorf("call[0]: expected arg 'clarify', got %v", call0.Args)
	}

	// Second call: registry-update.sh with ticket ID and new step
	call1 := mock.Calls[1]
	if call1.Name != "bash" {
		t.Errorf("call[1]: expected bash, got %q", call1.Name)
	}
	if !strings.Contains(call1.Args[0], "registry-update.sh") {
		t.Errorf("call[1]: expected registry-update.sh, got %v", call1.Args)
	}
	ticketFound := false
	stepFound := false
	for _, a := range call1.Args {
		if a == "BRE-1" {
			ticketFound = true
		}
		if strings.Contains(a, "current_step=") {
			stepFound = true
		}
	}
	if !ticketFound {
		t.Errorf("call[1]: ticketID BRE-1 not in args: %v", call1.Args)
	}
	if !stepFound {
		t.Errorf("call[1]: current_step= arg not in args: %v", call1.Args)
	}
}

type stubHandler struct {
	called bool
	ctx    *engine.Context
	out    *engine.Outcome
}

func (s *stubHandler) Execute(node *engine.Node, ctx *engine.Context, graph *engine.Graph, logsRoot string) *engine.Outcome {
	s.called = true
	s.ctx = ctx
	if s.out != nil {
		return s.out
	}
	return &engine.Outcome{Status: engine.StatusSuccess}
}

func TestProcess_RegisteredHandlerInvoked(t *testing.T) {
	mock := &runner.MockCommander{}
	eng := engine.NewExecutionEngine(mock, t.TempDir(), t.TempDir())

	h := &stubHandler{}
	eng.RegisterHandler("PLAN_COMPLETE", h)

	reg := registry.RegistryData{
		Nonce: "abc", AgentPaneID: "%1", OrchestratorPaneID: "%2", WorktreePath: "/tmp",
	}
	sig := engine.CollabSignal{TicketID: "BRE-1", Nonce: "abc", SignalType: "PLAN_COMPLETE", Detail: "done"}

	if err := eng.Process(sig, &reg); err != nil {
		t.Fatalf("Process() error: %v", err)
	}
	if !h.called {
		t.Fatal("handler was not called")
	}
	if h.ctx.TicketID != "BRE-1" {
		t.Errorf("ctx.TicketID = %q, want BRE-1", h.ctx.TicketID)
	}
	if h.ctx.OrchestratorPaneID != "%2" {
		t.Errorf("ctx.OrchestratorPaneID = %q, want %%2", h.ctx.OrchestratorPaneID)
	}
}

func TestProcess_UnknownSignalReturnsError(t *testing.T) {
	mock := &runner.MockCommander{}
	eng := engine.NewExecutionEngine(mock, t.TempDir(), t.TempDir())

	reg := registry.RegistryData{Nonce: "abc"}
	sig := engine.CollabSignal{TicketID: "BRE-1", Nonce: "abc", SignalType: "UNKNOWN_SIGNAL", Detail: "x"}

	err := eng.Process(sig, &reg)
	if err == nil {
		t.Fatal("expected error for unknown signal type")
	}
}
