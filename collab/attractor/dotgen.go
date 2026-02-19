package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type phaseConfig struct {
	Name    string   `json:"name"`
	Signals []string `json:"signals"`
}

type pipelineConfig struct {
	Phases []phaseConfig `json:"phases"`
}

// phaseOrder maps each phase to its successor for edge generation.
var phaseOrder = []string{"clarify", "plan", "tasks", "analyze", "implement", "blindqa", "done"}

func nextPhase(current string) string {
	for i, p := range phaseOrder {
		if p == current && i+1 < len(phaseOrder) {
			return phaseOrder[i+1]
		}
	}
	return "done"
}

// GenerateDOT reads pipeline.json and returns a Graphviz DOT graph string.
func GenerateDOT(pipelineConfigPath string) (string, error) {
	data, err := os.ReadFile(pipelineConfigPath)
	if err != nil {
		return "", fmt.Errorf("read pipeline config: %w", err)
	}
	var cfg pipelineConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return "", fmt.Errorf("parse pipeline config: %w", err)
	}
	if len(cfg.Phases) == 0 {
		return "", fmt.Errorf("pipeline config has no phases")
	}
	for _, p := range cfg.Phases {
		if p.Name == "" {
			return "", fmt.Errorf("phase with empty name in pipeline config")
		}
		if len(p.Signals) == 0 {
			return "", fmt.Errorf("phase %q has no signals", p.Name)
		}
	}

	var sb strings.Builder
	sb.WriteString("digraph pipeline {\n")
	sb.WriteString("  rankdir=LR;\n")
	sb.WriteString("  node [shape=box, style=filled, fillcolor=lightblue];\n")
	sb.WriteString("\n")

	for _, phase := range cfg.Phases {
		sb.WriteString(fmt.Sprintf("  %s [label=\"%s\"];\n", phase.Name, phase.Name))
	}
	sb.WriteString("\n")

	for _, phase := range cfg.Phases {
		next := nextPhase(phase.Name)
		for _, sig := range phase.Signals {
			sb.WriteString(fmt.Sprintf("  %s -> %s [label=\"%s\"];\n", phase.Name, next, sig))
		}
	}
	sb.WriteString("}\n")
	return sb.String(), nil
}
