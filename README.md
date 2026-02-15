# Relay

AI-powered spec creation platform that guides product teams through structured questioning to produce complete, unambiguous specs in < 30 minutes.

## Vision

Makes AI approachable for software teams by mapping AI capabilities to familiar role-based workflows. Teams work the way they already work (PM → Designer → QA → Engineer), but with AI assistance at each phase.

## The Problem

Engineers and product teams find AI intimidating - overwhelming hype, no clear starting point. They need familiar, structured workflows that leverage AI without requiring AI expertise.

**Key Insight:** The barrier is trust, not intimidation. Teams need repeated demonstrations of AI competence through transparent, structured assistance.

## Solution

Slack-first platform where PMs describe a feature, and Relay guides them through Blind QA (domain-specific questioning) to produce a complete spec that syncs to Jira/Linear.

**Core Value:** Complete specs in < 30 minutes through conversational AI instead of hours of back-and-forth.

## MVP Scope: PM Phase Only

### What's Included

✅ `/relay` command in Slack
✅ Variable-length feature description input
✅ AI-determined role analysis (Designer, Engineer, Security, etc.)
✅ BlindQA pattern channel naming (5 AI-generated suggestions or custom)
✅ Sequential team member selection prompts
✅ Auto-created coordination channel with team invites
✅ Blind QA with dynamic question count (AI determines based on complexity)
✅ Slack Block Kit interactive components (multiple choice + "other" option)
✅ Spec viewing via web endpoint (future: interactive, editable)
✅ Jira/Linear integration (create new ticket or update existing)

### What's Post-MVP

❌ Designer phase
❌ QA phase
❌ Engineer phase
❌ Autonomous implementation
❌ Spec versioning/history
❌ Analytics/reporting

## Architecture

### Plugin-Based System

```
Main Program (Node Backend)
├─ Blind QA Engine
├─ Spec State Management
└─ Protocol Orchestration
     │
     ├─> Comms Plugin (Slack) ──> Slack API
     └─> Ticketing Plugin (Jira/Linear) ──> Ticket API
```

**Key Principles:**

- Main program speaks generic JSON protocol
- Plugins translate to platform-specific APIs (Slack Block Kit, Jira REST, etc.)
- Easy to add Discord, Teams, GitHub Issues plugins later
- No platform lock-in

## PM Phase Workflow

1. **Initiate:** PM runs `/relay` with feature description
2. **Role Analysis:** Bot determines needed roles (Designer, Engineer, etc.)
3. **Channel Naming:** Bot suggests 5 semantic names (PM picks or custom)
4. **Team Selection:** Sequential prompts per role ("I need Designer, who?")
5. **Channel Created:** Bot creates channel, invites team
6. **Blind QA:** Auto-starts with dynamic question count
7. **Spec Complete:** Summary posted with view/sync options
8. **View Spec:** Web endpoint serves formatted HTML
9. **Sync to Jira/Linear:** Create new or update existing ticket

## Tech Stack

- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL (spec storage)
- **AI:** LLM integration for Blind QA question generation
- **Slack:** Block Kit for interactive UI
- **Ticketing:** Jira REST API + Linear GraphQL

## Development Roadmap

See Linear issues:
- **BRE-181:** MVP Core (Backend + Slack Plugin) - Weeks 1-3
- **BRE-182:** Ticketing Integration (Jira/Linear) - Weeks 2-4
- **BRE-183:** Production Launch (Testing, Beta, Public) - Weeks 4-5

## Success Metrics

**MVP Success:**

- PM creates spec in < 30 minutes
- Spec syncs to Jira with zero manual copying
- Designer receives spec with zero follow-up questions
- 80%+ of edge cases identified by Blind QA
- PM satisfaction: 8/10 or higher

**Adoption Goals (First 30 Days):**

- 10 specs created
- 5 active teams
- 2 complete features shipped using Relay specs

## Project Status

**Current:** Project initialized, MVP spec finalized
**Next:** Begin BRE-181 (Backend + Slack Plugin)

---

**Project Management:** [Linear Project](https://linear.app/bretthamlin/project/relay-3c21f1dcb104)
