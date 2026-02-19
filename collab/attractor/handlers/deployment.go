package handlers

import (
	"fmt"
	"os"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

const maxDeployRetries = 3

// DeploymentHandler triggers deployment and retries up to maxDeployRetries times.
type DeploymentHandler struct {
	cmd         runner.Commander
	repoRoot    string
	registryDir string
}

// NewDeploymentHandler creates a DeploymentHandler.
func NewDeploymentHandler(cmd runner.Commander, repoRoot, registryDir string) *DeploymentHandler {
	return &DeploymentHandler{cmd: cmd, repoRoot: repoRoot, registryDir: registryDir}
}

func (h *DeploymentHandler) Execute(_ *engine.Node, ctx *engine.Context, _ *engine.Graph, _ string) *engine.Outcome {
	reg, err := registry.ReadRegistry(h.registryDir, ctx.TicketID)
	if err != nil {
		msg := fmt.Sprintf("read registry for %s: %v", ctx.TicketID, err)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	if reg.RetryCount >= maxDeployRetries {
		// Escalate: 3 retries already attempted (4th total attempt).
		escalation := fmt.Sprintf(
			"Deployment for %s failed after %d retries. Manual intervention required.",
			ctx.TicketID, maxDeployRetries)
		fmt.Fprintln(os.Stderr, "[attractor]", escalation)
		if ctx.OrchestratorPaneID != "" {
			_ = h.sendTmux(ctx.OrchestratorPaneID, escalation)
		}
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: escalation}
	}

	// Increment retry_count via atomic write.
	newCount := reg.RetryCount + 1
	if err := registry.WriteField(h.registryDir, ctx.TicketID, "retry_count", newCount); err != nil {
		fmt.Fprintf(os.Stderr, "[attractor] WriteField retry_count: %v\n", err)
	}

	// Send deploy command to agent pane (async -- next IMPLEMENT_COMPLETE arrives on success).
	deployMsg := fmt.Sprintf(
		"Deploy. When done, send:\necho '[SIGNAL:%s:%s] IMPLEMENT_COMPLETE | deployment finished' > .collab/state/signal.pipe",
		ctx.TicketID, ctx.Nonce)
	if ctx.AgentPaneID != "" {
		_ = h.sendTmux(ctx.AgentPaneID, deployMsg)
	}

	return &engine.Outcome{Status: engine.StatusSuccess}
}

func (h *DeploymentHandler) sendTmux(paneID, message string) error {
	if len(message) > maxPromptBytes {
		message = message[:maxPromptBytes] + "\n[...truncated...]"
	}
	_, err := h.cmd.Run("bun", ".collab/scripts/orchestrator/Tmux.ts", "send",
		"-w", paneID, "-t", message, "-d", "1")
	return err
}
