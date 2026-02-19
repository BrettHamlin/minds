package runner

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Commander abstracts shell subprocess execution for testability.
type Commander interface {
	Run(name string, args ...string) ([]byte, error)
	RunCaptureSeparate(name string, args ...string) (stdout, stderr []byte, err error)
}

// ExecCommander is the production implementation.
type ExecCommander struct {
	WorkDir string
	Timeout time.Duration
}

func (e *ExecCommander) Run(name string, args ...string) ([]byte, error) {
	timeout := e.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	if e.WorkDir != "" {
		cmd.Dir = e.WorkDir
	}
	cmd.WaitDelay = 3 * time.Second
	out, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("command timed out after %v", timeout)
	}
	return out, err
}

func (e *ExecCommander) RunCaptureSeparate(name string, args ...string) ([]byte, []byte, error) {
	timeout := e.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	if e.WorkDir != "" {
		cmd.Dir = e.WorkDir
	}
	cmd.WaitDelay = 3 * time.Second
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, nil, fmt.Errorf("command timed out after %v", timeout)
	}
	return stdoutBuf.Bytes(), stderrBuf.Bytes(), err
}

// CallRecord records a single Commander invocation.
type CallRecord struct {
	Name string
	Args []string
}

// StubResult is a canned response for MockCommander.
type StubResult struct {
	Stdout []byte
	Stderr []byte
	Err    error
}

// MockCommander is a test-only implementation of Commander.
type MockCommander struct {
	Calls []CallRecord
	Stub  map[string]StubResult
}

func (m *MockCommander) key(name string, args []string) string {
	parts := append([]string{name}, args...)
	return strings.Join(parts, " ")
}

func (m *MockCommander) Run(name string, args ...string) ([]byte, error) {
	m.Calls = append(m.Calls, CallRecord{Name: name, Args: args})
	k := m.key(name, args)
	if s, ok := m.Stub[k]; ok {
		combined := append(append([]byte{}, s.Stdout...), s.Stderr...)
		return combined, s.Err
	}
	return nil, nil
}

func (m *MockCommander) RunCaptureSeparate(name string, args ...string) ([]byte, []byte, error) {
	m.Calls = append(m.Calls, CallRecord{Name: name, Args: args})
	k := m.key(name, args)
	if s, ok := m.Stub[k]; ok {
		return s.Stdout, s.Stderr, s.Err
	}
	return nil, nil, nil
}
