# Architecture Patterns: Local-to-Enterprise Deployment from a Single Codebase

Research compiled 2026-03-14. Focus: how production systems abstract between local/single-user and enterprise/multi-user deployment without forking the codebase.

---

## Table of Contents

1. [VS Code: Local/Remote Abstraction](#1-vs-code-localremote-abstraction)
2. [Terraform: Pluggable State Backends](#2-terraform-pluggable-state-backends)
3. [GitLab: Single Codebase, Multiple Deployment Modes](#3-gitlab-single-codebase-multiple-deployment-modes)
4. [Figma: State Sync and Offline Patterns](#4-figma-state-sync-and-offline-patterns)
5. [Enterprise Integration Stack](#5-enterprise-integration-stack)
6. [Pluggable Module Architecture](#6-pluggable-module-architecture)
7. [Cross-Cutting Patterns and Recommendations](#7-cross-cutting-patterns-and-recommendations)

---

## 1. VS Code: Local/Remote Abstraction

### The Core Pattern: Process Separation + Extension Classification

VS Code's architecture solves the local-vs-remote problem through **process isolation** and a **two-category extension model**. The key insight: separate the UI process from the "work" process, then let extensions declare which side they belong to.

### Architecture Layers

```
LOCAL MACHINE                          REMOTE MACHINE
+---------------------------+          +---------------------------+
|  VS Code Desktop / Browser|          |  VS Code Server           |
|  +---------------------+ |          |  +---------------------+ |
|  | Renderer Process     | |  IPC /   |  | Remote Extension    | |
|  | (Electron/Browser)   | | WebSocket|  | Host Process        | |
|  +---------------------+ |<-------->|  +---------------------+ |
|  | Local Extension Host | |          |  | File System Access  | |
|  | (UI Extensions)      | |          |  | Terminal             | |
|  +---------------------+ |          |  | Language Servers     | |
+---------------------------+          +---------------------------+
```

### Extension Classification System

Every extension declares an `extensionKind` that determines where it runs:

| Kind | Runs Where | Access To | Examples |
|------|-----------|-----------|----------|
| `ui` | Local machine (always) | Local APIs, UI contribution points | Themes, keymaps, snippets |
| `workspace` | Same machine as workspace | File system, terminals, language servers | Git, linters, debuggers |
| `ui` + `workspace` | VS Code picks optimal | Depends on where it runs | Extensions that work either way |

When no remote is involved, both kinds run locally. When a remote workspace exists, `workspace` extensions run on the VS Code Server (remote), `ui` extensions stay local.

### Key Abstractions

1. **Extension Host Process** -- Extensions never run in the main process. They get an isolated process with an IPC bridge. This means swapping local-for-remote is just swapping which machine hosts the process.

2. **`vscode.workspace.fs` API** -- Extensions don't use `fs.readFile()` directly. They use VS Code's file system API, which transparently resolves to local FS, SSH remote, container FS, or cloud storage.

3. **URI Scheme Routing** -- File paths are URIs (`vscode-remote://ssh-remote+host/path`). The scheme tells VS Code how to resolve the resource. Extensions that use URIs correctly work everywhere automatically.

4. **Server Lifecycle Management** -- The VS Code Server is installed on-demand when you connect to a remote. The client manages the server lifecycle (install, update, restart). The server is lightweight -- just an extension host + file system access + terminal.

### code-server / OpenVSCode Server Variant

code-server (by Coder) takes a different approach: it patches VS Code via a Git submodule and serves the full IDE over HTTP. Three-layer architecture:

- **Layer 1**: HTTP server, authentication, configuration, proxying (Node.js)
- **Layer 2**: VS Code integration via Git submodule with quilt patches
- **Layer 3**: Build/release pipeline

The key difference from Microsoft's approach: code-server serves the entire UI from the server, while VS Code's Remote Development keeps the UI local and only remotes the extension host.

### Pattern Summary

| Pattern | How It Works |
|---------|-------------|
| Process isolation | UI and workspace logic in separate processes |
| Extension classification | Declare where you run, system routes accordingly |
| Abstract file system | URI-based FS API hides local/remote |
| On-demand server | Lightweight server deployed when remote connection needed |
| IPC bridge | Same protocol whether local or across network |

---

## 2. Terraform: Pluggable State Backends

### The Core Pattern: Interface Hierarchy with Capability Wrapping

Terraform (and OpenTofu) solves the local-vs-cloud problem through a **backend interface hierarchy**. Simple backends store state; enhanced backends can also execute operations. The CLI wraps simple backends to add missing capabilities.

### Backend Interface Hierarchy

```
backend.Backend (base interface)
    |
    +-- StateMgr(ctx, workspace) -> statemgr.Full
    |       (every backend must return a state manager)
    |
    +-- backend.Enhanced (extends Backend)
            |
            +-- Operation(ctx, *Operation)
                    (can execute plan/apply/refresh remotely)
```

### How It Works in Practice

```
LOCAL MODE (default)                    CLOUD MODE
+------------------+                   +------------------+
| terraform CLI    |                   | terraform CLI    |
| +------+         |                   | +------+         |
| | Local |        |                   | | Cloud |        |
| | Backend        |                   | | Backend        |
| | (Enhanced)     |                   | | (Enhanced)     |
| +------+         |                   | +------+         |
| | State: file    |                   | | State: remote  |
| | Ops: local     |                   | | Ops: remote    |
+------------------+                   +------------------+

S3 / GCS / Azure MODE
+------------------+
| terraform CLI    |
| +------+         |
| | S3 Backend     |  <-- Only implements Backend (state storage)
| | (Simple)       |
| +------+         |
|      |           |
| [Wrapped with    |  <-- CLI wraps with local backend for ops
|  Local Backend]  |
+------------------+
```

### Key Abstractions

1. **`backend.Backend` Interface** -- Minimal contract: configure, provide state manager, list workspaces. Every backend implements this.

2. **`statemgr.Full` Interface** -- State managers handle read/write/lock/unlock of state. The interface is the same whether state lives in a local file, S3 bucket, or Terraform Cloud API.

3. **`backend.Enhanced` Interface** -- Adds `Operation()` for remote execution. Only Terraform Cloud/Enterprise implements this. Simple backends (S3, GCS, HTTP) don't.

4. **Wrapping Strategy** -- When a simple backend is configured, the CLI wraps it with a `local.Local` backend that provides operation execution. The simple backend handles state; the local wrapper handles plan/apply. This is the critical pattern: **capability wrapping lets simple implementations participate in a richer system**.

5. **Configuration Block** -- Backends are selected declaratively in HCL:

```hcl
# Local file state
terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}

# S3 state (ops still local)
terraform {
  backend "s3" {
    bucket = "my-state"
    key    = "prod/terraform.tfstate"
  }
}

# Cloud (state + ops remote)
terraform {
  cloud {
    organization = "my-org"
    workspaces { name = "prod" }
  }
}
```

### Pattern Summary

| Pattern | How It Works |
|---------|-------------|
| Interface hierarchy | Base interface + enhanced interface for more capabilities |
| Capability wrapping | Simple backends get wrapped with local execution |
| StateMgr abstraction | Same state interface for file, S3, HTTP, cloud API |
| Declarative backend selection | Config file determines backend, not code changes |
| Workspace multiplexing | Same interface supports multiple named workspaces |

---

## 3. GitLab: Single Codebase, Multiple Deployment Modes

### The Core Pattern: Packaging Abstraction + Component Architecture

GitLab ships one Rails monolith that runs identically in self-hosted and cloud modes. The differentiation happens at the **packaging and deployment layer**, not the application layer.

### Deployment Modes

```
SAME APPLICATION CODE
         |
         +--------+-----------+-------------------+
         |        |           |                   |
      Omnibus   Helm Chart   Cloud Native    GitLab.com
      (Linux    (K8s partial  First           (SaaS)
      package)   hybrid)     (K8s full)
```

| Mode | What It Is | Target |
|------|-----------|--------|
| **Omnibus** | Single Linux package bundles all services (Rails, Postgres, Redis, Nginx, Gitaly) | Self-hosted, simple |
| **Helm Chart (Cloud Native Hybrid)** | Stateless components (Webservice, Sidekiq) in K8s; stateful (Postgres, Redis) on VMs or managed services | Self-hosted, scalable |
| **Cloud Native First** | Everything in K8s; external managed services for data stores | Self-hosted or cloud, production scale |
| **GitLab.com** | SaaS -- same code, GitLab-managed infrastructure | Cloud customers |

### Key Abstractions

1. **Component Separation** -- GitLab decomposes into ~15 services (Webservice, Sidekiq, Gitaly, Registry, Pages, etc.). Each can be deployed independently or bundled together. Omnibus bundles everything; Helm charts deploy each as a separate pod.

2. **External Service Interfaces** -- PostgreSQL, Redis, and Object Storage are accessed through standard interfaces. The application doesn't care if Postgres is a local Omnibus-bundled instance or AWS RDS. Same connection string interface.

3. **Object Storage Abstraction** -- All binary storage (CI artifacts, LFS objects, uploads, container images) goes through an S3-compatible API. Self-hosted can use MinIO; cloud uses actual S3/GCS/Azure Blob.

4. **Feature Flags** -- GitLab uses internal feature flags extensively to gate features between tiers (Free, Premium, Ultimate) and between deployment modes. New features ship behind flags and get enabled progressively.

5. **Reference Architectures** -- GitLab publishes sized reference architectures (1k, 2k, 3k, 5k, 10k, 25k, 50k users) that specify exactly which components to deploy where. This is the scaling abstraction: same code, different topology.

### Pattern Summary

| Pattern | How It Works |
|---------|-------------|
| Monolith with service decomposition | One codebase, services can be co-located or distributed |
| Standard external interfaces | S3 API, Postgres protocol, Redis protocol -- swap implementations |
| Packaging as the abstraction layer | Omnibus, Helm, or raw containers from same source |
| Feature flags for tier gating | Same binary, different capabilities enabled |
| Reference architectures for scaling | Prescriptive deployment topologies by user count |

---

## 4. Figma: State Sync and Offline Patterns

### The Core Pattern: CRDT-Inspired Central Authority with Offline Replay

Figma solves multiplayer editing with a pragmatic approach: use CRDT concepts but keep a central server as the authority, simplifying conflict resolution significantly.

### Architecture

```
CLIENT A (browser/desktop)          SERVER (per-document process)
+---------------------+            +---------------------------+
| Local Document      |  WebSocket | Canonical Document State  |
| State (optimistic)  |<---------->| + Operation Log           |
| + Pending Ops Queue |            | + Client Tracking         |
+---------------------+            +---------------------------+
                                            ^
CLIENT B (browser/desktop)                  |
+---------------------+                    |
| Local Document      |  WebSocket         |
| State (optimistic)  |<-------------------+
| + Pending Ops Queue |
+---------------------+
```

### Key Design Decisions

1. **Not Pure CRDT** -- Figma was influenced by CRDTs but deliberately chose not to implement a full CRDT. Pure CRDTs are designed for decentralized systems with no central authority. Figma has a server, so it uses the server to simplify conflict resolution.

2. **Last-Writer-Wins Register** -- For property conflicts (two people change the same object's color), the last write wins. Simple, predictable, and sufficient for design tools where users typically work on different objects.

3. **Per-Document Server Process** -- Each open document gets its own server process. This isolates documents and simplifies state management. The server holds the canonical state and an operation log.

4. **Offline Strategy: Replay on Reconnect** -- When a client goes offline:
   - Continue editing locally, queuing operations
   - On reconnect, download fresh document state from server
   - Replay offline operations on top of the fresh state
   - Resume normal sync

   This avoids the complexity of merging divergent histories. The server's state is always authoritative.

5. **Optimistic Local Application** -- Clients apply operations locally before server confirmation. This makes the UI feel instant. If the server rejects or reorders an operation, the client reconciles.

### Pattern Summary

| Pattern | How It Works |
|---------|-------------|
| Central authority | Server is the source of truth, simplifies conflict resolution |
| CRDT-inspired (not pure) | Borrow concepts without full CRDT overhead |
| Last-writer-wins | Simple deterministic conflict resolution per property |
| Offline replay | Queue ops offline, replay on fresh state at reconnect |
| Optimistic local state | Apply locally first, reconcile with server later |
| Per-document isolation | Each document gets its own server process |

---

## 5. Enterprise Integration Stack

### Authentication: SSO Protocols

**Current landscape (2025-2026):**

| Protocol | Use Case | Adoption |
|----------|----------|----------|
| **SAML 2.0** | Enterprise SSO with legacy IdPs | Still dominant in large enterprises. Most Fortune 500 IdPs (Okta, Azure AD, OneLogin) support it natively. Required for enterprise sales. |
| **OIDC (OpenID Connect)** | Modern web/mobile SSO | Growing rapidly. Preferred for new implementations. Built on OAuth 2.0 with identity layer. Simpler to implement than SAML. |
| **OAuth 2.0** | API authorization (not authentication) | Ubiquitous for API access. Not an SSO protocol itself, but OIDC builds on it. |

**Recommendation:** Support both SAML 2.0 and OIDC. SAML is table-stakes for enterprise deals (their IdP likely speaks it). OIDC is where the industry is heading and is simpler for developer-focused products. Use Authorization Code Flow with PKCE for public clients.

### User Provisioning: SCIM

**SCIM (System for Cross-domain Identity Management)** is the standard protocol for automated user provisioning and deprovisioning.

- **Adoption**: Widely adopted by major IdPs (Okta, Azure AD/Entra, OneLogin, Workday). Expected by enterprise customers.
- **What it does**: When an employee joins, changes roles, or leaves, SCIM automatically creates/updates/deactivates their accounts across connected SaaS applications.
- **Key operations**: Create user, update user attributes, deactivate user, group membership sync.
- **Why it matters**: Without SCIM, enterprise IT admins must manually provision users in every tool. This is a dealbreaker for organizations managing 1,000+ applications.

**Implementation approach**: Use a service like WorkOS or build against the SCIM 2.0 spec (RFC 7643/7644). WorkOS provides a unified SCIM endpoint that works with 12+ identity providers out of the box, avoiding per-IdP custom connectors.

### Audit Logs

**What enterprises expect:**

1. **Structured events** with standard fields:
   - `actor` (who did it -- user ID, IP, user agent)
   - `action` (what happened -- `user.login`, `document.delete`, `permission.change`)
   - `target` (what was affected -- resource ID, resource type)
   - `context` (when, where -- timestamp, request ID, geo)
   - `outcome` (success/failure)

2. **Immutability** -- Audit logs must be tamper-evident. Append-only storage, cryptographic verification.

3. **Retention** -- Minimum 1 year for SOC 2, 6 years for some regulations. Configurable retention periods.

4. **Export/Streaming**:
   - **SIEM integration** -- Stream to Splunk, Datadog, QRadar, Sentinel via log streaming
   - **API access** -- REST API for programmatic access to audit events
   - **Webhook delivery** -- Real-time push of audit events to customer endpoints
   - **CloudEvents format** -- Emerging standard for event interoperability (used by Confluent, adopted by CNCF)

5. **Compliance frameworks**: SOC 2 Type II, HIPAA, GDPR, FedRAMP all require audit logging.

### Webhooks

**Standard patterns:**

1. **Event-driven push** -- POST to customer-registered URLs when events occur
2. **Payload format** -- JSON with event type, timestamp, resource data, and signature header
3. **Signature verification** -- HMAC-SHA256 with shared secret in header (e.g., `X-Signature-256`)
4. **Retry with backoff** -- Exponential backoff on failed deliveries (3-5 retries)
5. **Idempotency keys** -- Include event ID so receivers can deduplicate
6. **Event catalog** -- Publish a documented list of all event types
7. **Webhook management API** -- CRUD for webhook subscriptions, event filtering, delivery logs

### Access Control: RBAC vs ABAC

**RBAC is the standard starting point.** Nearly every enterprise SaaS product ships with RBAC first. It maps naturally to how organizations think: admins, editors, viewers.

| Aspect | RBAC | ABAC |
|--------|------|------|
| **Adoption** | Dominant. Expected by all enterprises. | Growing, but typically layered on RBAC. |
| **Complexity** | Low. Roles + permissions matrix. | High. Policy engine evaluating attributes at runtime. |
| **Best for** | Clear hierarchical roles, simple access patterns | Multi-tenant, geo-restrictions, time-based access, regulatory |
| **Implementation** | Role -> Permission mapping table | Policy engine (e.g., OPA, Cerbos, Cedar) |

**Industry pattern**: Start with RBAC. Add ABAC capabilities when customers need conditional access (multi-tenant isolation, data residency, device-aware policies). Many mature products use a hybrid: RBAC for baseline roles, ABAC for contextual overrides.

### Enterprise Integration Summary

| Capability | Protocol/Pattern | Priority |
|-----------|-----------------|----------|
| SSO | SAML 2.0 + OIDC | P0 (required for enterprise) |
| User provisioning | SCIM 2.0 | P0 (expected by enterprise IT) |
| Access control | RBAC (with ABAC roadmap) | P0 (ship with RBAC) |
| Audit logs | Structured events + SIEM streaming | P1 (required for compliance) |
| Webhooks | Signed JSON push + retry | P1 (expected for integrations) |
| API access | REST + API keys/OAuth tokens | P0 |

---

## 6. Pluggable Module Architecture

### Backstage (Spotify): The Reference Implementation

Backstage is the most instructive example of plugin architecture for developer platforms. Its "everything is a plugin" philosophy means even core features are plugins.

#### Package Structure

Each Backstage plugin consists of up to five packages:

```
@scope/plugin-<id>                    # Frontend plugin (React components)
@scope/plugin-<id>-react              # Frontend shared utilities/hooks
@scope/plugin-<id>-backend            # Backend plugin (Express routes)
@scope/plugin-<id>-node               # Backend shared utilities + extension points
@scope/plugin-<id>-common             # Isomorphic (shared types, constants)
```

Plus optional modules:
```
@scope/plugin-<id>-backend-module-<moduleId>   # Backend module extending the plugin
```

#### Frontend Plugin System

```typescript
// Creating a frontend plugin
import { createFrontendPlugin } from '@backstage/frontend-plugin-api';

const myPlugin = createFrontendPlugin({
  id: 'my-plugin',
  extensions: [myPage, myCard, myApiFactory],
  routes: { root: rootRouteRef },
});
```

Key concepts:
- **Extensions** -- Units of UI functionality (pages, cards, navigation items)
- **Extension Points** -- Parent declares attachment points; children attach to them
- **Utility APIs** -- Shared functionality (API clients, state management) exposed via dependency injection
- **Route References** -- Type-safe cross-plugin navigation

Communication flows one direction: child extension outputs data to parent extension through attachment points.

#### Backend Plugin System

```typescript
// Creating a backend plugin
import { createBackendPlugin } from '@backstage/backend-plugin-api';

const myBackendPlugin = createBackendPlugin({
  pluginId: 'my-plugin',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        database: coreServices.database,
        logger: coreServices.logger,
      },
      async init({ httpRouter, database, logger }) {
        // Plugin initialization with injected services
      },
    });
  },
});
```

Key concepts:
- **Service References (ServiceRef)** -- Named references to interfaces, resolved at runtime via dependency injection
- **Extension Points** -- Plugins expose extension points; modules consume them to add functionality
- **Core Services** -- httpRouter, database, logger, auth, permissions -- provided by the framework

Extension points vs services: both use dependency injection, but extension points are provided by plugins (not the framework) and define how other plugins/modules can extend a specific plugin.

### Grafana: Dual-Language Plugin System

Grafana uses a different approach: plugins have independent frontend (TypeScript/React) and backend (Go) components that communicate through well-defined protocols.

#### Plugin Types

| Type | Frontend | Backend | Purpose |
|------|----------|---------|---------|
| **Panel** | React component | Optional | Visualization (charts, tables, maps) |
| **Data Source** | Query editor + config editor | Go binary (gRPC) | Connect to data stores |
| **App** | Full application pages | Optional | Bundle panels + data sources + pages |

#### Architecture

```
GRAFANA SERVER (Go)
+------------------------------------------+
|  Plugin Manager                          |
|  +------------------------------------+  |
|  | Frontend Loader (SystemJS)         |  |
|  | - Loads plugin JS bundles at runtime|  |
|  | - Shared Grafana React packages    |  |
|  +------------------------------------+  |
|  | Backend Plugin Host (gRPC)         |  |
|  | - Each backend plugin = Go binary  |  |
|  | - Communicates via gRPC protocol   |  |
|  | - Lifecycle: start/stop/health     |  |
|  +------------------------------------+  |
+------------------------------------------+
```

Key abstractions:
- **`DataSourceApi`** -- Frontend interface all data source plugins implement
- **`DataSourceWithBackend`** -- Extended interface when backend processing is needed
- **gRPC protocol** -- Backend plugins are separate Go processes communicating via gRPC (using HashiCorp's go-plugin library)
- **Plugin signing** -- Grafana verifies plugin signatures before loading
- **Streaming support** -- Backend plugins can establish persistent connections for real-time data

### WordPress-Style Plugin Patterns (Generalized)

For completeness, the classic hook/filter pattern used by WordPress and adapted by many platforms:

```
CORE APPLICATION
+------------------------------------------+
|  Hook Registry                           |
|  +------------------------------------+  |
|  | "before_save" -> [plugin1, plugin2]|  |
|  | "after_render" -> [plugin3]        |  |
|  | "data_transform" -> [plugin4]      |  |
|  +------------------------------------+  |
|                                          |
|  Plugin Loader                           |
|  - Scan plugin directory                 |
|  - Load manifest (plugin.json)           |
|  - Register hooks/filters                |
|  - Inject dependencies                   |
+------------------------------------------+
```

### Plugin Architecture Pattern Summary

| Pattern | Backstage | Grafana | Generalized |
|---------|-----------|---------|-------------|
| **Isolation** | Packages (npm) | Processes (gRPC) | Directory-based |
| **Communication** | Extension points + DI | gRPC protocol | Hooks/filters |
| **Frontend loading** | Webpack federation | SystemJS | Script injection |
| **Backend loading** | Node.js modules | Go binary subprocess | Dynamic import |
| **Type safety** | TypeScript ServiceRef | Go interfaces + gRPC proto | Manifest schema |
| **Security** | Permission framework | Plugin signing | Capability sandboxing |

---

## 7. Cross-Cutting Patterns and Recommendations

### Meta-Pattern: The Interface Boundary

Every system studied uses the same fundamental pattern: **define an interface at the boundary between "what" and "how."**

```
WHAT (application logic)          HOW (deployment-specific)
+------------------+              +------------------+
| "Save state"     | -- Interface --> | Local file     |
|                  |              | S3 bucket        |
|                  |              | Cloud API         |
+------------------+              +------------------+

| "Run extension"  | -- Interface --> | Local process  |
|                  |              | Remote SSH        |
|                  |              | Container         |
+------------------+              +------------------+

| "Authenticate"   | -- Interface --> | Local password |
|                  |              | SAML/OIDC SSO    |
|                  |              | API key           |
+------------------+              +------------------+
```

### Six Architectural Strategies

Drawing from all six systems studied, these are the reusable strategies:

#### 1. Provider/Backend Pattern (Terraform)
Define a minimal interface for the core capability. Let implementations vary from trivial (local file) to sophisticated (cloud API). Use capability wrapping to add missing features to simple implementations.

**When to use**: State storage, data persistence, external service integration.

#### 2. Process Isolation + Classification (VS Code)
Run different concerns in separate processes. Classify components by where they need to run. Let the framework route to the right process based on the deployment context.

**When to use**: UI/backend split, local/remote execution, extension systems.

#### 3. Packaging Abstraction (GitLab)
Keep the application identical. Vary how components are packaged and deployed. Use standard protocols (S3, Postgres, Redis) so implementations are swappable.

**When to use**: Self-hosted vs cloud deployment, scaling from single-node to distributed.

#### 4. Optimistic Local + Authority Sync (Figma)
Apply changes locally for responsiveness. Use a central authority for conflict resolution. Replay local operations on reconnect.

**When to use**: Collaborative editing, offline support, real-time sync.

#### 5. Extension Point + Dependency Injection (Backstage)
Plugins declare what they need (dependencies) and what they offer (extension points). A framework resolves dependencies at runtime. Modules extend plugins through their declared extension points.

**When to use**: Pluggable platforms, developer portals, modular architectures.

#### 6. Dual-Layer Plugin System (Grafana)
Frontend plugins (JS/React) and backend plugins (separate processes via gRPC/IPC) with well-defined communication protocol. Each layer has its own lifecycle and isolation model.

**When to use**: When plugins need server-side computation, data access, or long-running processes.

### Recommended Architecture for a Developer Tool

For a developer tool that needs to work locally and scale to enterprise, apply these patterns in layers:

```
LAYER 1: Core Abstractions
+--------------------------------------------------+
| StateProvider interface (local file | cloud API)  |
| AuthProvider interface (local | SSO)              |
| StorageProvider interface (local FS | S3)         |
| EventBus interface (in-process | webhook/stream)  |
+--------------------------------------------------+

LAYER 2: Plugin System
+--------------------------------------------------+
| Plugin manifest (capabilities, dependencies)      |
| Extension points (declared by plugins)            |
| Service injection (framework provides core svcs)  |
| Frontend: dynamic loading (React components)      |
| Backend: isolated processes or modules            |
+--------------------------------------------------+

LAYER 3: Deployment Packaging
+--------------------------------------------------+
| Local: single process, file-based state, no auth  |
| Team: multi-process, shared state, basic auth     |
| Enterprise: distributed, SSO, SCIM, audit logs    |
+--------------------------------------------------+

LAYER 4: Enterprise Features (enabled by tier)
+--------------------------------------------------+
| SSO: SAML 2.0 + OIDC                             |
| Provisioning: SCIM 2.0                           |
| Access: RBAC (with ABAC extension point)          |
| Audit: structured logs + SIEM streaming           |
| Webhooks: signed events + retry                   |
+--------------------------------------------------+
```

### Second-Order Effects to Consider

1. **Local-first means offline-first thinking** -- Even if you don't need offline mode now, designing for it (optimistic local state, sync protocol) means your architecture naturally supports disconnected/slow-network scenarios that enterprise VPN users face daily.

2. **Plugin isolation is security** -- If plugins run in-process, a malicious or buggy plugin compromises everything. Grafana's process isolation (gRPC) is heavier but safer. Backstage's npm packages are lighter but trust-dependent. Choose based on who writes your plugins.

3. **SCIM creates the user lifecycle problem** -- Once you support SCIM, you must handle user deactivation gracefully (what happens to their data, active sessions, API keys?). This ripples through your entire data model.

4. **Feature flags as the tier boundary** -- GitLab's approach (same binary, feature-flagged tiers) is simpler than maintaining separate builds. But it means enterprise code ships to everyone, which has security audit implications.

5. **State backend choice constrains collaboration** -- Terraform's local file backend is great for solo use but makes collaboration impossible. The moment you add cloud state, you need locking, access control, and state encryption. Design the state interface to support these from day one.

---

## Sources

### VS Code Architecture
- [VS Code Extension Host Documentation](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Supporting Remote Development and Codespaces](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [VS Code Server Documentation](https://code.visualstudio.com/docs/remote/vscode-server)
- [VS Code Server Blog Post (2022)](https://code.visualstudio.com/blogs/2022/07/07/vscode-server)
- [code-server by Coder (GitHub)](https://github.com/coder/code-server)
- [code-server Architecture (DeepWiki)](https://deepwiki.com/coder/code-server)

### Terraform / OpenTofu Backend Architecture
- [OpenTofu Backend Architecture (DeepWiki)](https://deepwiki.com/opentofu/opentofu/5.1-backend-architecture)
- [Terraform Backend Block Configuration](https://developer.hashicorp.com/terraform/language/backend)
- [HCP Terraform CLI Integration](https://developer.hashicorp.com/terraform/cli/cloud)
- [Terraform Architecture Overview (Spacelift)](https://spacelift.io/blog/terraform-architecture)

### GitLab Architecture
- [GitLab Architecture Overview](https://docs.gitlab.com/development/architecture/)
- [GitLab Reference Architectures](https://docs.gitlab.com/administration/reference_architectures/)
- [GitLab Helm Chart](https://docs.gitlab.com/charts/)
- [GitLab Feature Flags](https://docs.gitlab.com/ee/administration/feature_flags.html)

### Figma Multiplayer Architecture
- [How Figma's Multiplayer Technology Works (Figma Blog)](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [How Figma's Multiplayer Technology Works (Evan Wallace)](https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/)
- [Making Multiplayer More Reliable (Figma Blog)](https://www.figma.com/blog/making-multiplayer-more-reliable/)
- [Server Architectures for Central Server Collaboration (Matthew Weidner)](https://mattweidner.com/2024/06/04/server-architectures.html)

### Enterprise Integration
- [SSO Deep Dive: SAML, OAuth, SCIM (Deepak Gupta)](https://guptadeepak.com/sso-deep-dive-saml-oauth-and-scim-in-enterprise-identity-management/)
- [SSO Best Practices 2025 (Clerk)](https://clerk.com/articles/sso-best-practices-for-secure-scalable-logins)
- [SAML vs OIDC vs SCIM Guide (Stitchflow)](https://www.stitchflow.com/blog/saml-oidc-scim-guide-it-leaders)
- [RBAC vs ABAC (Oso)](https://www.osohq.com/learn/rbac-vs-abac)
- [RBAC vs ABAC (Cerbos)](https://www.cerbos.dev/blog/rbac-vs-abac)
- [Enterprise Ready SaaS RBAC Guide](https://www.enterpriseready.io/features/role-based-access-control/)
- [WorkOS Developer Guide to Audit Logs/SIEM](https://workos.com/blog/the-developers-guide-to-audit-logs-siem)
- [WorkOS SCIM Guide](https://workos.com/guide/the-developers-guide-to-scim)

### Plugin Architecture
- [Backstage Architecture Overview](https://backstage.io/docs/overview/architecture-overview/)
- [Backstage Backend Extension Points](https://backstage.io/docs/backend-system/architecture/extension-points/)
- [Backstage Frontend Extensions](https://backstage.io/docs/frontend-system/architecture/extensions/)
- [Backstage Plugin Structure](https://backstage.io/docs/plugins/structure-of-a-plugin/)
- [Everything is a Plugin (QCon Talk)](https://qconlondon.com/presentation/apr2024/everything-plugin-how-backstage-architecture-helps-platform-teams-spotify-and)
- [Grafana Plugin System (DeepWiki)](https://deepwiki.com/grafana/grafana/11-plugin-system)
- [Grafana Data Source Backend Plugin Tutorial](https://grafana.com/developers/plugin-tools/tutorials/build-a-data-source-backend-plugin)
