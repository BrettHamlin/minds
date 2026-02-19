package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

func writeTestRegistry(t *testing.T, dir, ticketID string, reg registry.RegistryData) {
	t.Helper()
	data, _ := json.Marshal(reg)
	os.WriteFile(filepath.Join(dir, ticketID+".json"), data, 0644)
}

// --- ParseSignal tests ---

var parseTests = []struct {
	name    string
	input   string
	wantErr bool
	want    *engine.CollabSignal
}{
	{
		name:  "valid signal",
		input: "[SIGNAL:BRE-216:20dba] PLAN_COMPLETE | plan phase finished",
		want:  &engine.CollabSignal{TicketID: "BRE-216", Nonce: "20dba", SignalType: "PLAN_COMPLETE", Detail: "plan phase finished"},
	},
	{
		name:    "missing nonce brackets",
		input:   "[SIGNAL:BRE-216] PLAN_COMPLETE | plan phase finished",
		wantErr: true,
	},
	{
		name:    "missing pipe separator",
		input:   "[SIGNAL:BRE-216:abc] PLAN_COMPLETE plan phase finished",
		wantErr: true,
	},
	{
		name:    "empty line",
		input:   "",
		wantErr: true,
	},
	{
		name:    "uppercase hex in nonce (must be lowercase)",
		input:   "[SIGNAL:BRE-216:20DBA] PLAN_COMPLETE | plan phase finished",
		wantErr: true,
	},
	{
		name:  "valid with multiple words in detail",
		input: "[SIGNAL:FEAT-001:abcdef] ANALYZE_COMPLETE | analysis of main module finished with 3 findings",
		want: &engine.CollabSignal{
			TicketID: "FEAT-001", Nonce: "abcdef",
			SignalType: "ANALYZE_COMPLETE", Detail: "analysis of main module finished with 3 findings",
		},
	},
}

func TestParseSignal(t *testing.T) {
	for _, tc := range parseTests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseSignal(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Errorf("ParseSignal(%q) = %+v, want error", tc.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseSignal(%q) error: %v", tc.input, err)
			}
			if got.TicketID != tc.want.TicketID {
				t.Errorf("TicketID = %q, want %q", got.TicketID, tc.want.TicketID)
			}
			if got.Nonce != tc.want.Nonce {
				t.Errorf("Nonce = %q, want %q", got.Nonce, tc.want.Nonce)
			}
			if got.SignalType != tc.want.SignalType {
				t.Errorf("SignalType = %q, want %q", got.SignalType, tc.want.SignalType)
			}
			if got.Detail != tc.want.Detail {
				t.Errorf("Detail = %q, want %q", got.Detail, tc.want.Detail)
			}
		})
	}
}

// --- validateNonce tests ---

func TestValidateNonce_Match(t *testing.T) {
	tmp := t.TempDir()
	writeTestRegistry(t, tmp, "BRE-1", registry.RegistryData{
		Nonce: "abc123", OrchestratorPaneID: "%5",
	})
	mock := &runner.MockCommander{}
	sig := &engine.CollabSignal{TicketID: "BRE-1", Nonce: "abc123"}
	if err := validateNonce(sig, tmp, mock); err != nil {
		t.Fatalf("validateNonce() unexpected error: %v", err)
	}
	if len(mock.Calls) != 0 {
		t.Errorf("expected no tmux calls on match, got %d", len(mock.Calls))
	}
}

func TestValidateNonce_Mismatch_LogsAndNotifiesTmux(t *testing.T) {
	tmp := t.TempDir()
	writeTestRegistry(t, tmp, "BRE-2", registry.RegistryData{
		Nonce: "correct", OrchestratorPaneID: "%7",
	})
	mock := &runner.MockCommander{}
	sig := &engine.CollabSignal{TicketID: "BRE-2", Nonce: "wrong"}
	err := validateNonce(sig, tmp, mock)
	if err == nil {
		t.Fatal("validateNonce() expected error on mismatch")
	}
	if !strings.Contains(err.Error(), "nonce mismatch") {
		t.Errorf("error message %q does not contain 'nonce mismatch'", err.Error())
	}
	if !strings.Contains(err.Error(), "wrong") {
		t.Errorf("error message %q does not contain signal nonce 'wrong'", err.Error())
	}
	// Verify tmux notification was sent to orchestrator pane
	found := false
	for _, call := range mock.Calls {
		if call.Name == "bun" {
			for _, arg := range call.Args {
				if arg == "%7" {
					found = true
				}
			}
		}
	}
	if !found {
		t.Errorf("expected tmux send to orchestrator pane %%7, got calls: %+v", mock.Calls)
	}
}

// --- Bridge tests ---

func newTestBridge(t *testing.T) (*Bridge, *engine.ExecutionEngine, *runner.MockCommander, string) {
	t.Helper()
	tmp := t.TempDir()
	mock := &runner.MockCommander{}
	eng := engine.NewExecutionEngine(mock, tmp, tmp)
	b := NewBridge(eng, mock, tmp, tmp)
	return b, eng, mock, tmp
}

func TestBridge_Dispatch_NewTicketCreatesGoroutine(t *testing.T) {
	b, eng, _, regDir := newTestBridge(t)
	_ = eng

	writeTestRegistry(t, regDir, "BRE-99", registry.RegistryData{Nonce: "abc"})

	var processed sync.WaitGroup
	processed.Add(1)
	h := &captureHandler{done: &processed}
	b.eng.RegisterHandler("PLAN_COMPLETE", h)
	b.eng.RegisterPassthrough()

	sig := engine.CollabSignal{TicketID: "BRE-99", Nonce: "abc", SignalType: "PLAN_COMPLETE", Detail: "d"}
	b.dispatch(sig)

	done := make(chan struct{})
	go func() {
		processed.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for signal processing")
	}
}

func TestBridge_Dispatch_SameTicketUsesExistingChannel(t *testing.T) {
	b, _, _, regDir := newTestBridge(t)

	writeTestRegistry(t, regDir, "BRE-100", registry.RegistryData{Nonce: "xyz"})

	var mu sync.Mutex
	processCount := 0
	var wg sync.WaitGroup
	wg.Add(2)
	h := &countHandler{mu: &mu, count: &processCount, wg: &wg}
	b.eng.RegisterHandler("PLAN_COMPLETE", h)

	sig1 := engine.CollabSignal{TicketID: "BRE-100", Nonce: "xyz", SignalType: "PLAN_COMPLETE", Detail: "first"}
	sig2 := engine.CollabSignal{TicketID: "BRE-100", Nonce: "xyz", SignalType: "PLAN_COMPLETE", Detail: "second"}
	b.dispatch(sig1)
	b.dispatch(sig2)

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for both signals")
	}
	mu.Lock()
	defer mu.Unlock()
	if processCount != 2 {
		t.Errorf("expected 2 signals processed, got %d", processCount)
	}
}

// Helper handlers for tests.

type captureHandler struct {
	done *sync.WaitGroup
}

func (h *captureHandler) Execute(_ *engine.Node, _ *engine.Context, _ *engine.Graph, _ string) *engine.Outcome {
	h.done.Done()
	return &engine.Outcome{Status: engine.StatusSuccess}
}

type countHandler struct {
	mu    *sync.Mutex
	count *int
	wg    *sync.WaitGroup
}

func (h *countHandler) Execute(_ *engine.Node, _ *engine.Context, _ *engine.Graph, _ string) *engine.Outcome {
	h.mu.Lock()
	*h.count++
	h.mu.Unlock()
	h.wg.Done()
	return &engine.Outcome{Status: engine.StatusSuccess}
}
