package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

// VerifyConfig defines the test command configuration.
type VerifyConfig struct {
	Command    string  `json:"command"`
	Timeout    int     `json:"timeout"`
	WorkingDir *string `json:"working_dir"`
}

// VerifyPattern defines a regex-based failure detector.
type VerifyPattern struct {
	Pattern string `json:"pattern"`
	Label   string `json:"label"`
}

// VerifyHandler enforces the NO EXCUSES policy.
type VerifyHandler struct {
	cmd      runner.Commander
	repoRoot string
}

// NewVerifyHandler creates a VerifyHandler.
func NewVerifyHandler(cmd runner.Commander, repoRoot string) *VerifyHandler {
	return &VerifyHandler{cmd: cmd, repoRoot: repoRoot}
}

func (h *VerifyHandler) Execute(_ *engine.Node, ctx *engine.Context, _ *engine.Graph, _ string) *engine.Outcome {
	configPath := filepath.Join(h.repoRoot, ".collab", "config", "verify-config.json")
	cfgData, err := os.ReadFile(configPath)
	if err != nil {
		msg := fmt.Sprintf("verify-config.json not found at %s -- run 'collab install' to scaffold it: %v",
			configPath, err)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}
	var cfg VerifyConfig
	if err := json.Unmarshal(cfgData, &cfg); err != nil {
		msg := fmt.Sprintf("parse verify-config.json: %v", err)
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	patterns := h.loadPatterns()
	workDir := ctx.WorktreePath
	if cfg.WorkingDir != nil && *cfg.WorkingDir != "" {
		workDir = *cfg.WorkingDir
	}

	timeout := time.Duration(cfg.Timeout) * time.Second
	if timeout == 0 {
		timeout = 120 * time.Second
	}

	parts := strings.Fields(cfg.Command)
	if len(parts) == 0 {
		msg := "verify-config.json command is empty"
		fmt.Fprintln(os.Stderr, "[attractor]", msg)
		return &engine.Outcome{Status: engine.StatusFail, FailureReason: msg}
	}

	execCmd := &runner.ExecCommander{WorkDir: workDir, Timeout: timeout}
	stdout, stderr, err := execCmd.RunCaptureSeparate(parts[0], parts[1:]...)
	combined := append(append([]byte{}, stdout...), stderr...)

	if err != nil {
		return h.fail(ctx, combined, fmt.Sprintf("tests exited non-zero: %v", err))
	}

	for _, pat := range patterns {
		re, compErr := regexp.Compile(pat.Pattern)
		if compErr != nil {
			fmt.Fprintf(os.Stderr, "[attractor] invalid pattern %q: %v\n", pat.Pattern, compErr)
			continue
		}
		if re.Match(combined) {
			return h.fail(ctx, combined, fmt.Sprintf("pattern match: %s", pat.Label))
		}
	}

	return &engine.Outcome{Status: engine.StatusSuccess}
}

func (h *VerifyHandler) loadPatterns() []VerifyPattern {
	path := filepath.Join(h.repoRoot, ".collab", "config", "verify-patterns.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var patterns []VerifyPattern
	json.Unmarshal(data, &patterns)
	return patterns
}

func (h *VerifyHandler) fail(ctx *engine.Context, output []byte, reason string) *engine.Outcome {
	lines := bytes.Split(output, []byte("\n"))
	maxLines := 50
	if len(lines) > maxLines {
		lines = lines[:maxLines]
	}
	excerpt := string(bytes.Join(lines, []byte("\n")))

	msg := fmt.Sprintf(`NO EXCUSES: Tests failed. Fix ALL failures before proceeding.

%s

Re-run when fixed: .collab/scripts/verify-and-complete.sh implement 'Implementation complete'`,
		excerpt)

	fmt.Fprintln(os.Stderr, "[attractor] NO EXCUSES:", reason)
	if ctx.AgentPaneID != "" {
		if len(msg) > maxPromptBytes {
			msg = msg[:maxPromptBytes] + "\n[...truncated...]"
		}
		_, _ = h.cmd.Run("bun", ".collab/scripts/orchestrator/Tmux.ts", "send",
			"-w", ctx.AgentPaneID, "-t", msg, "-d", "1")
	}
	return &engine.Outcome{Status: engine.StatusFail, FailureReason: reason}
}
