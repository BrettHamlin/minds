package handlers

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/registry"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

const maxPromptBytes = 64 * 1024

// AIGateHandler assembles review prompts and forwards them to the orchestrator pane.
type AIGateHandler struct {
	cmd         runner.Commander
	repoRoot    string
	registryDir string
}

// NewAIGateHandler creates a new AIGateHandler.
func NewAIGateHandler(cmd runner.Commander, repoRoot, registryDir string) *AIGateHandler {
	return &AIGateHandler{cmd: cmd, repoRoot: repoRoot, registryDir: registryDir}
}

func (h *AIGateHandler) Execute(_ *engine.Node, ctx *engine.Context, _ *engine.Graph, _ string) *engine.Outcome {
	switch ctx.SignalType {
	case "PLAN_COMPLETE", "PLAN_REVIEW_NEEDED":
		return h.handlePlanReview(ctx)
	case "ANALYZE_COMPLETE":
		return h.handleAnalyzeReview(ctx)
	default:
		err := fmt.Sprintf("AIGateHandler: unexpected signal %q", ctx.SignalType)
		fmt.Fprintln(os.Stderr, "[attractor]", err)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: err}
	}
}

func (h *AIGateHandler) handlePlanReview(ctx *engine.Context) *engine.Outcome {
	templatePath := filepath.Join(h.repoRoot, ".collab", "config", "gates", "plan-review-prompt.md")
	tmpl, err := os.ReadFile(templatePath)
	if err != nil {
		msg := fmt.Sprintf("plan-review-prompt.md not found at %s: %v", templatePath, err)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	prompt := h.assemblePlanPrompt(string(tmpl), ctx.WorktreePath)
	if err := h.sendToOrchestrator(ctx.OrchestratorPaneID, prompt); err != nil {
		fmt.Fprintf(os.Stderr, "[attractor] tmux send failed: %v\n", err)
	}
	return &engine.Outcome{Status: engine.StatusSuccess}
}

func (h *AIGateHandler) assemblePlanPrompt(tmpl, worktreePath string) string {
	files := map[string]string{
		"{{SPEC_MD}}":       h.readArtifact(worktreePath, "spec.md"),
		"{{PLAN_MD}}":       h.readArtifact(worktreePath, "plan.md"),
		"{{DATA_MODEL_MD}}": h.readArtifact(worktreePath, "data-model.md"),
		"{{RESEARCH_MD}}":   h.readArtifact(worktreePath, "research.md"),
	}
	result := tmpl
	for k, v := range files {
		result = strings.ReplaceAll(result, k, v)
	}
	return result
}

func (h *AIGateHandler) readArtifact(worktreePath, filename string) string {
	// Try specs/*/{filename}
	pattern := filepath.Join(worktreePath, "specs", "*", filename)
	matches, _ := filepath.Glob(pattern)
	if len(matches) > 0 {
		data, err := os.ReadFile(matches[0])
		if err == nil {
			return string(data)
		}
	}
	// Try root/{filename}
	data, err := os.ReadFile(filepath.Join(worktreePath, filename))
	if err == nil {
		return string(data)
	}
	return fmt.Sprintf("[%s not found]", filename)
}

func (h *AIGateHandler) handleAnalyzeReview(ctx *engine.Context) *engine.Outcome {
	reg, err := registry.ReadRegistry(h.registryDir, ctx.TicketID)
	if err != nil {
		msg := fmt.Sprintf("read registry for %s: %v", ctx.TicketID, err)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	var templateFile, phase string
	if !reg.AnalysisRemediationDone {
		templateFile = "analyze-review-prompt.md"
		phase = "Phase 1"
		// Set analysis_remediation_done = true
		if err := registry.WriteField(h.registryDir, ctx.TicketID, "analysis_remediation_done", true); err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] WriteField analysis_remediation_done: %v\n", err)
		}
	} else {
		templateFile = "analyze-review-prompt.md"
		phase = "Phase 2 (escalation)"
	}

	templatePath := filepath.Join(h.repoRoot, ".collab", "config", "gates", templateFile)
	tmpl, err := os.ReadFile(templatePath)
	if err != nil {
		msg := fmt.Sprintf("%s not found at %s: %v", templateFile, templatePath, err)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	prompt := h.assembleAnalyzePrompt(string(tmpl), ctx.WorktreePath, phase, reg.AnalysisRemediationDone)
	if err := h.sendToOrchestrator(ctx.OrchestratorPaneID, prompt); err != nil {
		fmt.Fprintf(os.Stderr, "[attractor] tmux send failed: %v\n", err)
	}
	return &engine.Outcome{Status: engine.StatusSuccess}
}

func (h *AIGateHandler) assembleAnalyzePrompt(tmpl, worktreePath, phase string, isPhase2 bool) string {
	header := fmt.Sprintf("## Analyze Review -- %s\n\n", phase)
	if isPhase2 {
		header += "**ESCALATION**: All prior findings must be resolved before proceeding.\n\n"
	}
	tasks := h.readArtifact(worktreePath, "tasks.md")
	spec := h.readArtifact(worktreePath, "spec.md")
	result := strings.ReplaceAll(tmpl, "{{PHASE}}", phase)
	result = strings.ReplaceAll(result, "{{TASKS_MD}}", tasks)
	result = strings.ReplaceAll(result, "{{SPEC_MD}}", spec)
	return header + result
}

func (h *AIGateHandler) sendToOrchestrator(paneID, message string) error {
	if len(message) > maxPromptBytes {
		message = message[:maxPromptBytes] + "\n[...truncated at 64KB limit...]"
	}
	_, err := h.cmd.Run("bun", ".collab/scripts/orchestrator/Tmux.ts", "send",
		"-w", paneID, "-t", message, "-d", "1")
	return err
}
