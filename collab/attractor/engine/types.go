package engine

// CollabSignal is the parsed representation of a pipeline signal.
type CollabSignal struct {
	TicketID   string
	Nonce      string
	SignalType string
	Detail     string
}

// Status represents the outcome of a handler execution.
type Status int

const (
	StatusSuccess Status = iota
	StatusFail
)

// Handler processes a single signal for a ticket.
type Handler interface {
	Execute(node *Node, ctx *Context, graph *Graph, logsRoot string) *Outcome
}

// Outcome is the result returned by every handler.
type Outcome struct {
	Status         Status
	PreferredLabel string
	FailureReason  string
}

// Context carries the full registry state through handler execution.
type Context struct {
	TicketID                string
	Nonce                   string
	CurrentStep             string
	Status                  string
	AgentPaneID             string
	OrchestratorPaneID      string
	WorktreePath            string
	GroupID                 string
	SignalType              string
	Detail                  string
	ErrorCount              int
	RetryCount              int
	AnalysisRemediationDone bool
}

// Node represents a phase in the pipeline graph.
type Node struct {
	Name    string
	Signals []string
}

// Edge represents a transition between phases.
type Edge struct {
	From  string
	To    string
	Label string
}

// Graph represents the full pipeline topology.
type Graph struct {
	Nodes []Node
	Edges []Edge
}
