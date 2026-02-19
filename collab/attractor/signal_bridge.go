package main

import (
	"fmt"
	"os"
	"regexp"
	"sync"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

// signalRe matches: [SIGNAL:TICKET_ID:NONCE] TYPE | DETAIL
var signalRe = regexp.MustCompile(`^\[SIGNAL:([A-Z]+-\d+):([a-f0-9]+)\] ([A-Z_]+) \| (.+)$`)

const maxTmuxMsgBytes = 64 * 1024

// ParseSignal parses a wire-format signal line.
func ParseSignal(line string) (*engine.CollabSignal, error) {
	m := signalRe.FindStringSubmatch(line)
	if m == nil {
		return nil, fmt.Errorf("malformed signal: %q", line)
	}
	return &engine.CollabSignal{
		TicketID:   m[1],
		Nonce:      m[2],
		SignalType: m[3],
		Detail:     m[4],
	}, nil
}

// sendTmux sends a message to a tmux pane via Tmux.ts, with 64KB truncation.
func sendTmux(cmd runner.Commander, paneID, message string) error {
	if len(message) > maxTmuxMsgBytes {
		message = message[:maxTmuxMsgBytes] + "\n[...truncated at 64KB limit...]"
	}
	_, err := cmd.Run("bun", ".collab/scripts/orchestrator/Tmux.ts", "send",
		"-w", paneID, "-t", message, "-d", "1")
	return err
}

// validateNonce checks the signal nonce against the registry.
// On mismatch, logs to stderr and sends a tmux notification to the orchestrator pane.
func validateNonce(sig *engine.CollabSignal, registryDir string, cmd runner.Commander) error {
	reg, err := registry.ReadRegistry(registryDir, sig.TicketID)
	if err != nil {
		return fmt.Errorf("registry lookup for %s: %w", sig.TicketID, err)
	}
	if reg.Nonce != sig.Nonce {
		msg := fmt.Sprintf("NONCE MISMATCH for %s: signal nonce=%q registry nonce=%q. Proceed or abort?",
			sig.TicketID, sig.Nonce, reg.Nonce)
		fmt.Fprintf(os.Stderr, "[attractor] %s\n", msg)
		if reg.OrchestratorPaneID != "" && cmd != nil {
			_ = sendTmux(cmd, reg.OrchestratorPaneID, msg)
		}
		return fmt.Errorf("nonce mismatch for %s: got %q, expected %q",
			sig.TicketID, sig.Nonce, reg.Nonce)
	}
	return nil
}

// Bridge is the goroutine-per-ticket signal dispatcher.
type Bridge struct {
	workers  sync.Map // ticketID -> chan engine.CollabSignal
	wg       sync.WaitGroup
	eng      *engine.ExecutionEngine
	cmd      runner.Commander
	repoRoot string
	regDir   string
}

// NewBridge creates a Bridge.
func NewBridge(eng *engine.ExecutionEngine, cmd runner.Commander, repoRoot, regDir string) *Bridge {
	return &Bridge{eng: eng, cmd: cmd, repoRoot: repoRoot, regDir: regDir}
}

// dispatch routes a signal to the per-ticket goroutine, creating one if needed.
func (b *Bridge) dispatch(sig engine.CollabSignal) {
	ch := make(chan engine.CollabSignal, 32)
	actual, loaded := b.workers.LoadOrStore(sig.TicketID, ch)
	if loaded {
		actual.(chan engine.CollabSignal) <- sig
		return
	}
	// New ticket: start goroutine, then send signal.
	b.wg.Add(1)
	go b.runTicket(sig.TicketID, ch)
	ch <- sig
}

// runTicket processes all signals for a single ticket sequentially.
func (b *Bridge) runTicket(ticketID string, ch chan engine.CollabSignal) {
	defer b.wg.Done()
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "[attractor] panic in ticket %s: %v\n", ticketID, r)
			b.workers.Delete(ticketID)
		}
	}()
	for sig := range ch {
		reg, err := registry.ReadRegistry(b.regDir, sig.TicketID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] registry error for %s: %v\n", ticketID, err)
			continue
		}
		if err := b.eng.Process(sig, reg); err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] process error for %s: %v\n", ticketID, err)
		}
	}
}

// Shutdown closes all ticket channels and waits for goroutines to drain.
func (b *Bridge) Shutdown() {
	b.workers.Range(func(k, v any) bool {
		close(v.(chan engine.CollabSignal))
		return true
	})
	b.wg.Wait()
}
