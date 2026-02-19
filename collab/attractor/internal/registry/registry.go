package registry

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// RegistryData mirrors the pipeline-registry JSON schema.
type RegistryData struct {
	Nonce                   string `json:"nonce"`
	CurrentStep             string `json:"current_step"`
	Status                  string `json:"status"`
	ColorIndex              int    `json:"color_index,omitempty"`
	GroupID                 string `json:"group_id"`
	AgentPaneID             string `json:"agent_pane_id"`
	OrchestratorPaneID      string `json:"orchestrator_pane_id"`
	WorktreePath            string `json:"worktree_path"`
	LastSignal              string `json:"last_signal,omitempty"`
	LastSignalAt            string `json:"last_signal_at,omitempty"`
	ErrorCount              int    `json:"error_count"`
	RetryCount              int    `json:"retry_count"`
	AnalysisRemediationDone bool   `json:"analysis_remediation_done"`
}

// ReadRegistry returns the parsed registry for a given ticket.
func ReadRegistry(registryDir, ticketID string) (*RegistryData, error) {
	path := filepath.Join(registryDir, ticketID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read registry %s: %w", ticketID, err)
	}
	var reg RegistryData
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("parse registry %s: %w", ticketID, err)
	}
	return &reg, nil
}

// WriteField atomically updates a single field in the registry JSON.
func WriteField(registryDir, ticketID, field string, value any) error {
	path := filepath.Join(registryDir, ticketID+".json")
	return atomicUpdateJSON(path, func(m map[string]any) error {
		m[field] = value
		return nil
	})
}

func atomicUpdateJSON(path string, updater func(map[string]any) error) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	if err := updater(m); err != nil {
		return err
	}
	updated, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "registry-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(updated); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("rename temp: %w", err)
	}
	return nil
}
