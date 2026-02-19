package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/bretthamlin/collab/attractor/engine"
	"github.com/bretthamlin/collab/attractor/handlers"
	"github.com/bretthamlin/collab/attractor/internal/runner"
)

func main() {
	input := flag.String("input", "stdin", `Input mode: "stdin" or "pipe"`)
	graph := flag.Bool("graph", false, "Emit DOT graph from pipeline.json to stdout and exit")
	flag.Parse()

	repoRoot, err := findRepoRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[attractor] %v\n", err)
		os.Exit(1)
	}

	if *graph {
		pipelinePath := filepath.Join(repoRoot, ".collab", "config", "pipeline.json")
		dot, err := GenerateDOT(pipelinePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] graph error: %v\n", err)
			os.Exit(1)
		}
		fmt.Print(dot)
		return
	}

	if *input != "stdin" && *input != "pipe" {
		fmt.Fprintf(os.Stderr, "[attractor] --input must be \"stdin\" or \"pipe\", got %q\n", *input)
		flag.Usage()
		os.Exit(1)
	}

	cmd := &runner.ExecCommander{WorkDir: repoRoot, Timeout: 0}
	regDir := filepath.Join(repoRoot, ".collab", "state", "pipeline-registry")
	eng := engine.NewExecutionEngine(cmd, repoRoot, regDir)
	handlers.RegisterAll(eng, cmd, repoRoot, regDir)
	bridge := NewBridge(eng, cmd, repoRoot, regDir)

	if *input == "stdin" {
		runStdin(bridge, cmd, regDir)
	} else {
		runPipe(bridge, cmd, repoRoot, regDir)
	}
	bridge.Shutdown()
}

func runStdin(bridge *Bridge, cmd runner.Commander, regDir string) {
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		sig, err := ParseSignal(line)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] parse error: %v\n", err)
			continue
		}
		if err := validateNonce(sig, regDir, cmd); err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] nonce error: %v\n", err)
			continue
		}
		bridge.dispatch(*sig)
	}
}

func runPipe(bridge *Bridge, cmd runner.Commander, repoRoot, regDir string) {
	pipePath := filepath.Join(repoRoot, ".collab", "state", "signal.pipe")
	for {
		f, err := os.OpenFile(pipePath, os.O_RDONLY, os.ModeNamedPipe)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[attractor] pipe open error: %v\n", err)
			return
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}
			sig, err := ParseSignal(line)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[attractor] parse error: %v\n", err)
				continue
			}
			if err := validateNonce(sig, regDir, cmd); err != nil {
				fmt.Fprintf(os.Stderr, "[attractor] nonce error: %v\n", err)
				continue
			}
			bridge.dispatch(*sig)
		}
		f.Close()
		// Writer closed pipe; re-open and wait for next writer.
	}
}

func findRepoRoot() (string, error) {
	// Walk up directories to find .collab/
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, ".collab")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			// At filesystem root -- default to cwd
			cwd, _ := os.Getwd()
			return cwd, nil
		}
		dir = parent
	}
}
