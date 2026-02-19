package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sixPhasePipeline = `{
  "phases": [
    {"name":"clarify","signals":["CLARIFY_COMPLETE","CLARIFY_QUESTION","CLARIFY_ERROR"]},
    {"name":"plan","signals":["PLAN_COMPLETE","PLAN_REVIEW_NEEDED","PLAN_ERROR"]},
    {"name":"tasks","signals":["TASKS_COMPLETE","TASKS_ERROR"]},
    {"name":"analyze","signals":["ANALYZE_COMPLETE","ANALYZE_ERROR"]},
    {"name":"implement","signals":["IMPLEMENT_COMPLETE","IMPLEMENT_WAITING","IMPLEMENT_ERROR"]},
    {"name":"blindqa","signals":["BLINDQA_COMPLETE","BLINDQA_FAILED","BLINDQA_ERROR"]}
  ]
}`

func writePipeline(t *testing.T, dir, content string) string {
	t.Helper()
	path := filepath.Join(dir, "pipeline.json")
	os.WriteFile(path, []byte(content), 0644)
	return path
}

func TestGenerateDOT_SixPhases(t *testing.T) {
	path := writePipeline(t, t.TempDir(), sixPhasePipeline)
	dot, err := GenerateDOT(path)
	if err != nil {
		t.Fatalf("GenerateDOT() error: %v", err)
	}
	if !strings.Contains(dot, "digraph pipeline") {
		t.Error("missing 'digraph pipeline'")
	}
	if !strings.Contains(dot, "rankdir=LR") {
		t.Error("missing 'rankdir=LR'")
	}
	for _, phase := range []string{"clarify", "plan", "tasks", "analyze", "implement", "blindqa"} {
		if !strings.Contains(dot, phase) {
			t.Errorf("missing phase node %q", phase)
		}
	}
	for _, sig := range []string{"PLAN_COMPLETE", "CLARIFY_COMPLETE", "ANALYZE_COMPLETE", "IMPLEMENT_COMPLETE", "BLINDQA_COMPLETE"} {
		if !strings.Contains(dot, sig) {
			t.Errorf("missing signal edge label %q", sig)
		}
	}
}

func TestGenerateDOT_MalformedJSON_ReturnsError(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "pipeline.json")
	os.WriteFile(path, []byte("{not json}"), 0644)
	dot, err := GenerateDOT(path)
	if err == nil {
		t.Errorf("expected error for malformed JSON, got dot: %q", dot)
	}
	if dot != "" {
		t.Errorf("expected empty dot on error, got %q", dot)
	}
}

func TestGenerateDOT_EmptyPhases_ReturnsError(t *testing.T) {
	path := writePipeline(t, t.TempDir(), `{"phases":[]}`)
	_, err := GenerateDOT(path)
	if err == nil {
		t.Error("expected error for empty phases array")
	}
}

func TestGenerateDOT_SinglePhase_ValidDOT(t *testing.T) {
	path := writePipeline(t, t.TempDir(), `{"phases":[{"name":"alpha","signals":["ALPHA_DONE"]}]}`)
	dot, err := GenerateDOT(path)
	if err != nil {
		t.Fatalf("GenerateDOT() error: %v", err)
	}
	if !strings.Contains(dot, "alpha") {
		t.Error("missing phase node 'alpha'")
	}
	if !strings.Contains(dot, "ALPHA_DONE") {
		t.Error("missing signal 'ALPHA_DONE'")
	}
}

func TestGenerateDOT_DOT_ContainsRankdirLR(t *testing.T) {
	path := writePipeline(t, t.TempDir(), sixPhasePipeline)
	dot, err := GenerateDOT(path)
	if err != nil {
		t.Fatalf("GenerateDOT() error: %v", err)
	}
	if !strings.Contains(dot, "rankdir=LR") {
		t.Errorf("expected rankdir=LR in DOT output")
	}
}
