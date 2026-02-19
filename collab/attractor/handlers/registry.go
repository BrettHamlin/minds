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

	// Pass-through signals: call phase-advance.sh directly.
	eng.RegisterPassthrough(
		"PLAN_ERROR",
		"ANALYZE_ERROR",
		"CLARIFY_COMPLETE",
		"CLARIFY_QUESTION",
		"CLARIFY_ERROR",
		"TASKS_COMPLETE",
		"TASKS_ERROR",
		"IMPLEMENT_WAITING",
		"IMPLEMENT_ERROR",
		"BLINDQA_ERROR",
		"BLINDQA_COMPLETE",
		"BLINDQA_FAILED",
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
