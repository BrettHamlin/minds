package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

// groupQueryResult mirrors group-manage.sh query stdout JSON.
type groupQueryResult struct {
	Role      string `json:"role"`
	GroupID   string `json:"group_id"`
	GateState string `json:"gate_state"`
}

// GroupManagerHandler coordinates grouped tickets.
type GroupManagerHandler struct {
	cmd         runner.Commander
	repoRoot    string
	registryDir string
}

// NewGroupManagerHandler creates a GroupManagerHandler.
func NewGroupManagerHandler(cmd runner.Commander, repoRoot, registryDir string) *GroupManagerHandler {
	return &GroupManagerHandler{cmd: cmd, repoRoot: repoRoot, registryDir: registryDir}
}

func (h *GroupManagerHandler) Execute(node *engine.Node, ctx *engine.Context, graph *engine.Graph, logsRoot string) *engine.Outcome {
	groupManage := filepath.Join(h.repoRoot, ".collab", "scripts", "orchestrator", "group-manage.sh")
	out, err := h.cmd.Run("bash", groupManage, "query", ctx.TicketID)
	if err != nil {
		msg := fmt.Sprintf("group-manage.sh query %s: %v\n%s", ctx.TicketID, err, out)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	var result groupQueryResult
	if err := json.Unmarshal(out, &result); err != nil {
		msg := fmt.Sprintf("parse group-manage.sh output: %v -- raw: %s", err, out)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	switch result.Role {
	case "other", "backend":
		_, _ = h.cmd.Run("bash", groupManage, "update", ctx.GroupID, "gate_state", "backend_deploying")
		deploy := NewDeploymentHandler(h.cmd, h.repoRoot, h.registryDir)
		return deploy.Execute(node, ctx, graph, logsRoot)

	case "frontend":
		switch result.GateState {
		case "pending", "backend_deploying":
			registryUpdate := filepath.Join(h.repoRoot, ".collab", "scripts", "orchestrator", "registry-update.sh")
			_, _ = h.cmd.Run("bash", registryUpdate, ctx.TicketID, "status=held")
			return &engine.Outcome{Status: engine.StatusSuccess}
		case "backend_deployed":
			verify := NewVerifyHandler(h.cmd, h.repoRoot)
			return verify.Execute(node, ctx, graph, logsRoot)
		case "backend_failed":
			msg := fmt.Sprintf("backend for group %s failed; frontend %s cannot proceed", ctx.GroupID, ctx.TicketID)
			fmt.Fprintln(os.Stderr, "[attractor]", msg)
			if ctx.OrchestratorPaneID != "" {
				_, _ = h.cmd.Run("bun", ".collab/scripts/orchestrator/Tmux.ts", "send",
					"-w", ctx.OrchestratorPaneID, "-t", msg, "-d", "1")
			}
			return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
		default:
			msg := fmt.Sprintf("unknown gate_state %q for group %s", result.GateState, ctx.GroupID)
			fmt.Fprintln(os.Stderr, "[attractor]", msg)
			return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
		}

	default:
		msg := fmt.Sprintf("unknown role %q for ticket %s", result.Role, ctx.TicketID)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}
}
