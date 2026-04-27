# Agent System: Idempotency Middleware

## Overview

This document describes the multi-agent development system for the `@reaatech/idempotency-middleware` project. The system uses specialized AI agents, each with specific skills, to collaboratively build and maintain the idempotency middleware.

**Repository:** `github.com/reaatech/idempotency-middleware`

---

## Agent Architecture

### Core Agents

| Agent | Role | Skills Directory |
|-------|------|------------------|
| **Architect** | System design, API design, technical decisions | `skills/architect/` |
| **Core Developer** | TypeScript implementation, core logic | `skills/core-developer/` |
| **Storage Specialist** | Storage adapter implementations | `skills/storage-specialist/` |
| **Framework Integrator** | Express, Koa, and raw handler integrations | `skills/framework-integrator/` |
| **Test Engineer** | Unit, integration, and E2E tests | `skills/test-engineer/` |
| **DevOps Engineer** | CI/CD, build configuration, publishing | `skills/devops-engineer/` |
| **Documentation Writer** | API docs, examples, README | `skills/documentation-writer/` |
| **Code Reviewer** | Quality assurance, security review | `skills/code-reviewer/` |

---

## Agent Skills Structure

```
skills/
├── architect/
│   ├── skills.md           # System design skills
│   └── examples/           # Design examples
├── core-developer/
│   ├── skills.md           # TypeScript core implementation
│   └── examples/           # Code examples
├── storage-specialist/
│   ├── skills.md           # Storage adapter skills
│   └── examples/           # Adapter examples
├── framework-integrator/
│   ├── skills.md           # Framework integration skills
│   └── examples/           # Integration examples
├── test-engineer/
│   ├── skills.md           # Testing skills
│   └── examples/           # Test examples
├── devops-engineer/
│   ├── skills.md           # DevOps skills
│   └── examples/           # CI/CD examples
├── documentation-writer/
│   ├── skills.md           # Documentation skills
│   └── examples/           # Doc examples
└── code-reviewer/
    ├── skills.md           # Code review skills
    └── examples/           # Review examples
```

---

## Workflow

### 1. Planning Phase

```
User Request
    │
    ▼
Architect Agent
    │
    ├── Analyze requirements
    ├── Design solution
    ├── Create technical spec
    └── Define interfaces
    │
    ▼
Technical Specification
```

### 2. Implementation Phase

```
Technical Specification
    │
    ├──► Core Developer ─────► Core types and middleware
    │
    ├──► Storage Specialist ──► Storage adapters
    │
    ├──► Framework Integrator ► Express/Koa/handler
    │
    └──► Test Engineer ───────► Test suite
    │
    ▼
Implementation Complete
```

### 3. Quality Phase

```
Implementation
    │
    ├──► Code Reviewer ───────► Security & quality review
    │
    ├──► Documentation Writer ► API docs & examples
    │
    └──► DevOps Engineer ─────► CI/CD & publishing
    │
    ▼
Production Ready
```

---

## Agent Communication Protocol

### Message Format

```typescript
interface AgentMessage {
  from: string;           // Sender agent name
  to: string[];           // Recipient agent names
  type: 'request' | 'response' | 'notification';
  subject: string;        // Message subject
  content: unknown;       // Message content
  priority: 'low' | 'normal' | 'high';
  requiresResponse: boolean;
}
```

### Example Communication

```json
{
  "from": "architect",
  "to": ["core-developer", "storage-specialist"],
  "type": "request",
  "subject": "Implement StorageAdapter interface",
  "content": {
    "interface": "StorageAdapter",
    "methods": ["get", "set", "delete", "exists", "connect", "disconnect"],
    "deadline": "phase-2"
  },
  "priority": "high",
  "requiresResponse": true
}
```

---

## Skill Definitions

Each agent has a set of skills defined in their respective `skills/<agent>/skills.md` file. Skills include:

1. **Capabilities** - What the agent can do
2. **Tools** - What tools the agent uses
3. **Constraints** - What limitations the agent has
4. **Quality Standards** - What quality criteria the agent follows
5. **Examples** - Example outputs from the agent

---

## Project-Specific Constraints

This is a **public npm package** (`@reaatech/idempotency-middleware`) published under the **MIT license**. All agents must respect the following:

- **Backward Compatibility**: No breaking changes in minor versions. Public APIs must be deprecated before removal.
- **Zero-Config Defaults**: The in-memory adapter must work out of the box with no configuration.
- **Optional Dependencies**: Frameworks and storage backends are optional peer dependencies. The core must not require them.
- **Bundle Size**: Keep the core bundle small. Avoid heavy transitive dependencies.
- **Node.js 18+**: Must run on Node.js 18 and later.

## Quality Gates

Before any code is merged, it must pass through these quality gates:

| Gate | Responsible Agent | Criteria |
|------|-------------------|----------|
| **Type Safety** | Code Reviewer | No `any` types, strict null checks |
| **Test Coverage** | Test Engineer | >90% line coverage, >85% branch coverage |
| **Security** | Code Reviewer | No vulnerabilities, input validation |
| **Documentation** | Documentation Writer | TSDoc comments, examples |
| **Build** | DevOps Engineer | Clean build, no warnings |
| **Performance** | Core Developer | No performance regressions |

---

## Error Handling

### Agent Failures

When an agent fails to complete a task:

1. **Retry** - Attempt the task again (max 3 times)
2. **Escalate** - Notify the Architect agent
3. **Fallback** - Use a simpler approach if available
4. **Block** - Stop the workflow if critical

### Failure Recovery

```typescript
interface FailureRecovery {
  agent: string;
  task: string;
  error: Error;
  recovery: 'retry' | 'escalate' | 'fallback' | 'block';
  message: string;
}
```

---

## API Stability Guidance

When proposing changes, agents must consider the impact on the public API:

- **Patch fixes**: Bug fixes only. No API changes.
- **Minor features**: Additive only. New options, new adapters, new framework support. Never remove or change existing signatures.
- **Major releases**: Breaking changes allowed only with migration guides and deprecation warnings in the previous major version.

Agents should prefer additive changes (new config options, new methods) over modifying existing behavior.

## Configuration

### Agent Configuration

```yaml
# .agents.yaml
agents:
  architect:
    enabled: true
    priority: high
    timeout: 300  # seconds
  
  core-developer:
    enabled: true
    priority: normal
    timeout: 600
  
  storage-specialist:
    enabled: true
    priority: normal
    timeout: 600
  
  framework-integrator:
    enabled: true
    priority: normal
    timeout: 300
  
  test-engineer:
    enabled: true
    priority: high
    timeout: 900
  
  devops-engineer:
    enabled: true
    priority: low
    timeout: 300
  
  documentation-writer:
    enabled: true
    priority: normal
    timeout: 300
  
  code-reviewer:
    enabled: true
    priority: high
    timeout: 300
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-04-22 | Initial agent system design |

---

## References

- [DEV_PLAN.md](./DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture
- [skills/](./skills/) - Agent skill definitions
