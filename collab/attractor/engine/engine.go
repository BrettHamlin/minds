package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

// ExecutionEngine coordinates handler registration, dispatch, and pass-through routing.
type ExecutionEngine struct {
	handlers       map[string]Handler
	passthrough    map[string]bool
	noops          map[string]bool
	fixedTransition map[string]string // signalType -> target phase
	cmd            runner.Commander
	repoRoot       string
	registryDir    string
}

// NewExecutionEngine creates a new ExecutionEngine.
func NewExecutionEngine(cmd runner.Commander, repoRoot, registryDir string) *ExecutionEngine {
	return &ExecutionEngine{
		handlers:        make(map[string]Handler),
		passthrough:     make(map[string]bool),
		noops:           make(map[string]bool),
		fixedTransition: make(map[string]string),
		cmd:             cmd,
		repoRoot:        repoRoot,
		registryDir:     registryDir,
	}
}

// RegisterHandler associates a signal type with a handler.
func (e *ExecutionEngine) RegisterHandler(signalType string, h Handler) {
	e.handlers[signalType] = h
}

// RegisterPassthrough marks a signal type as pass-through (calls phase-advance.sh directly).
func (e *ExecutionEngine) RegisterPassthrough(signalTypes ...string) {
	for _, st := range signalTypes {
		e.passthrough[st] = true
	}
}

// RegisterNoOp marks signal types as acknowledged-but-ignored (no phase change).
// Used for _WAITING, _QUESTION, and _ERROR signals the orchestrator handles directly.
func (e *ExecutionEngine) RegisterNoOp(signalTypes ...string) {
	for _, st := range signalTypes {
		e.noops[st] = true
	}
}

// RegisterFixedTransition maps a signal type to a specific target phase,
// bypassing phase-advance.sh. Used for backward transitions like BLINDQA_FAILED → implement.
func (e *ExecutionEngine) RegisterFixedTransition(signalType, targetPhase string) {
	e.fixedTransition[signalType] = targetPhase
}

// Process routes a validated signal to its handler or pass-through path.
func (e *ExecutionEngine) Process(sig CollabSignal, reg *registry.RegistryData) error {
	// No-op: signal is valid but requires no phase change (orchestrator handles it).
	if e.noops[sig.SignalType] {
		return nil
	}

	// Fixed transition: jump directly to a named phase (used for backward transitions).
	if targetPhase, ok := e.fixedTransition[sig.SignalType]; ok {
		registryUpdatePath := filepath.Join(e.repoRoot, ".collab", "scripts", "orchestrator", "registry-update.sh")
		if _, err := e.cmd.Run("bash", registryUpdatePath, sig.TicketID, "current_step="+targetPhase, "status=running"); err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] registry-update.sh fixed-transition failed for %s: %v\n", sig.TicketID, err)
			return fmt.Errorf("fixed-transition registry-update for %s: %w", sig.TicketID, err)
		}
		return nil
	}

	if e.passthrough[sig.SignalType] {
		advancePath := filepath.Join(e.repoRoot, ".collab", "scripts", "orchestrator", "phase-advance.sh")
		nextPhaseBytes, err := e.cmd.Run("bash", advancePath, reg.CurrentStep)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] phase-advance.sh failed for %s %s: %v\n%s\n",
				sig.TicketID, sig.SignalType, err, nextPhaseBytes)
			return fmt.Errorf("phase-advance for %s %s: %w", sig.TicketID, sig.SignalType, err)
		}
		nextPhase := strings.TrimSpace(string(nextPhaseBytes))
		registryUpdatePath := filepath.Join(e.repoRoot, ".collab", "scripts", "orchestrator", "registry-update.sh")
		updateArg := "current_step=" + nextPhase
		if _, err := e.cmd.Run("bash", registryUpdatePath, sig.TicketID, updateArg, "status=running"); err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] registry-update.sh failed for %s: %v\n", sig.TicketID, err)
			return fmt.Errorf("registry-update for %s: %w", sig.TicketID, err)
		}
		return nil
	}

	h, ok := e.handlers[sig.SignalType]
	if !ok {
		err := fmt.Errorf("unknown signal type %q for ticket %s", sig.SignalType, sig.TicketID)
		fmt.Fprintf(os.Stderr, "[attractor] %v\n", err)
		return err
	}

	ctx := &Context{
		TicketID:                sig.TicketID,
		Nonce:                   sig.Nonce,
		CurrentStep:             reg.CurrentStep,
		Status:                  reg.Status,
		AgentPaneID:             reg.AgentPaneID,
		OrchestratorPaneID:      reg.OrchestratorPaneID,
		WorktreePath:            reg.WorktreePath,
		GroupID:                 reg.GroupID,
		SignalType:              sig.SignalType,
		Detail:                  sig.Detail,
		ErrorCount:              reg.ErrorCount,
		RetryCount:              reg.RetryCount,
		AnalysisRemediationDone: reg.AnalysisRemediationDone,
	}

	outcome := h.Execute(nil, ctx, nil, "")
	if outcome == nil {
		fmt.Fprintf(os.Stderr, "[attractor] handler returned nil outcome for %s %s\n",
			sig.TicketID, sig.SignalType)
		return fmt.Errorf("nil outcome for %s %s", sig.TicketID, sig.SignalType)
	}
	if outcome.Status == StatusFail {
		fmt.Fprintf(os.Stderr, "[attractor] handler failed for %s %s: %s\n",
			sig.TicketID, sig.SignalType, outcome.FailureReason)
	}
	return nil
}

// RegistryDir returns the configured registry directory.
func (e *ExecutionEngine) RegistryDir() string {
	return e.registryDir
}
