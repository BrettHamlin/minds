package handlers

import (
	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

// RegisterAll registers all signal-type -> handler and pass-through mappings.
func RegisterAll(eng *engine.ExecutionEngine, cmd runner.Commander, repoRoot, registryDir string) {
	aiGate := NewAIGateHandler(cmd, repoRoot, registryDir)
	verify := NewVerifyHandler(cmd, repoRoot)
	deploy := NewDeploymentHandler(cmd, repoRoot, registryDir)
	groupMgr := NewGroupManagerHandler(cmd, repoRoot, registryDir)

	eng.RegisterHandler("PLAN_COMPLETE", aiGate)
	eng.RegisterHandler("PLAN_REVIEW_NEEDED", aiGate)
	eng.RegisterHandler("ANALYZE_COMPLETE", aiGate)

	// IMPLEMENT_COMPLETE: group tickets go through GroupManagerHandler;
	// non-group tickets go directly to VerifyHandler.
	eng.RegisterHandler("IMPLEMENT_COMPLETE", &implementRouter{
		verify:   verify,
		groupMgr: groupMgr,
	})

	_ = deploy // deploy is used inside GroupManagerHandler

	// True pass-throughs: advance to the next phase in sequence.
	eng.RegisterPassthrough(
		"CLARIFY_COMPLETE",
		"TASKS_COMPLETE",
		"BLINDQA_COMPLETE",
	)

	// Fixed backward transition: BLINDQA_FAILED sends the ticket back to implement.
	eng.RegisterFixedTransition("BLINDQA_FAILED", "implement")

	// No-ops: signal is valid and acknowledged, but phase does not change.
	// The orchestrator (Claude Code) handles these directly (retries, answers questions, etc.).
	eng.RegisterNoOp(
		"CLARIFY_QUESTION",
		"CLARIFY_ERROR",
		"PLAN_ERROR",
		"TASKS_ERROR",
		"ANALYZE_ERROR",
		"IMPLEMENT_WAITING",
		"IMPLEMENT_ERROR",
		"BLINDQA_QUESTION",
		"BLINDQA_WAITING",
		"BLINDQA_ERROR",
	)
}

// implementRouter dispatches IMPLEMENT_COMPLETE to the right handler based on group_id.
type implementRouter struct {
	verify   *VerifyHandler
	groupMgr *GroupManagerHandler
}

func (r *implementRouter) Execute(node *engine.Node, ctx *engine.Context, graph *engine.Graph, logsRoot string) *engine.Outcome {
	if ctx.GroupID != "" {
		return r.groupMgr.Execute(node, ctx, graph, logsRoot)
	}
	return r.verify.Execute(node, ctx, graph, logsRoot)
}
