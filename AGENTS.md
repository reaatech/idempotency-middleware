# Agent System: Idempotency Middleware

## Overview

This document describes the multi-agent development system for the `@reaatech/idempotency-middleware` monorepo. The system uses specialized AI agents, each with specific skills, to collaboratively build and maintain the idempotency middleware packages.

**Repository:** `github.com/reaatech/idempotency-middleware`

**Monorepo structure:** pnpm workspace with 6 publishable packages under `packages/` and 2 example packages under `examples/`.

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
│   └── skills.md
├── core-developer/
│   └── skills.md
├── storage-specialist/
│   └── skills.md
├── framework-integrator/
│   └── skills.md
├── test-engineer/
│   └── skills.md
├── devops-engineer/
│   └── skills.md
├── documentation-writer/
│   └── skills.md
└── code-reviewer/
    └── skills.md
```

---

## Monorepo Package Structure

```
idempotency-middleware/
├── packages/
│   ├── core/                     → @reaatech/idempotency-middleware
│   ├── adapter-redis/            → @reaatech/idempotency-middleware-adapter-redis
│   ├── adapter-dynamodb/         → @reaatech/idempotency-middleware-adapter-dynamodb
│   ├── adapter-firestore/        → @reaatech/idempotency-middleware-adapter-firestore
│   ├── express/                  → @reaatech/idempotency-middleware-express
│   └── koa/                      → @reaatech/idempotency-middleware-koa
├── examples/
│   ├── express-memory/
│   └── koa-redis/
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.json / tsconfig.typecheck.json
├── .changeset/
├── .github/workflows/{ci,release}.yml
└── skills/
```

---

## Toolchain

| Concern | Tool | Config |
|---|---|---|
| Package manager | pnpm 10 | `pnpm-workspace.yaml`, `.npmrc` |
| Monorepo orchestration | Turborepo 2 | `turbo.json` |
| Build | tsup 8 (per package) | `tsup src/index.ts --format cjs,esm --dts --clean` |
| Linting | Biome 1.9 | `biome.json` |
| Formatting | Biome 1.9 | same config |
| Testing | Vitest 3 | `vitest.config.ts` per package |
| Type checking | TypeScript 5.8 | `tsconfig.typecheck.json` |
| Versioning | Changesets | `.changeset/config.json` |
| CI/CD | GitHub Actions | `.github/workflows/` |

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
    ├──► Core Developer ─────► packages/core
    │
    ├──► Storage Specialist ──► packages/adapter-{redis,dynamodb,firestore}
    │
    ├──► Framework Integrator ► packages/{express,koa}
    │
    └──► Test Engineer ───────► co-located *.test.ts files
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
    ├──► Documentation Writer ► API docs, examples, README
    │
    └──► DevOps Engineer ─────► CI/CD & Changesets publishing
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
  "subject": "Implement StorageAdapter interface for Redis",
  "content": {
    "interface": "StorageAdapter",
    "methods": ["get", "set", "delete", "connect", "disconnect", "acquireLock", "releaseLock", "waitForLock"],
    "package": "packages/adapter-redis",
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
2. **Tools** - What tools the agent uses (Biome, pnpm, tsup, turborepo, vitest, etc.)
3. **Constraints** - What limitations the agent has
4. **Quality Standards** - What quality criteria the agent follows
5. **Examples** - Example outputs from the agent

---

## Project-Specific Constraints

This is a **public npm monorepo** (`@reaatech/idempotency-middleware` and 5 sibling packages) published under the **MIT license**. All agents must respect the following:

- **Backward Compatibility**: No breaking changes in minor versions. Public APIs must be deprecated before removal.
- **Monorepo discipline**: Each package has a single responsibility. Cross-package dependencies use `workspace:*`. Adapter and framework packages depend on `@reaatech/idempotency-middleware` (core).
- **Zero-Config Defaults**: The `MemoryAdapter` in `packages/core` must work out of the box with no configuration or external dependencies.
- **Peer Dependencies**: Framework and storage backends are `peerDependencies` or `dependencies` of their respective packages. The core package must have zero production dependencies.
- **Bundle Size**: Keep each package's bundle small. Core must have no transitive dependencies beyond `node:crypto` built-ins.
- **Node.js 18+**: Must run on Node.js 18 and later.
- **Dual ESM/CJS**: Every publishable package must produce both ESM and CJS output via tsup.

## Quality Gates

Before any code is merged, it must pass through these quality gates:

| Gate | Responsible Agent | Criteria |
|------|-------------------|----------|
| **Type Safety** | Code Reviewer | No `any` types, strict null checks, `verbatimModuleSyntax` enabled |
| **Test Coverage** | Test Engineer | >90% line coverage, >85% branch coverage (per package) |
| **Security** | Code Reviewer | No vulnerabilities, input validation |
| **Documentation** | Documentation Writer | TSDoc comments, README per package, examples |
| **Build** | DevOps Engineer | Clean build via `turbo run build`, all packages produce `dist/` |
| **Format & Lint** | Code Reviewer | Biome check passes (`biome check .`) |
| **Type Check** | DevOps Engineer | `tsc --noEmit -p tsconfig.typecheck.json` passes |
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

---

## Release Flow

This project uses Changesets for versioning:

```bash
pnpm changeset              # Interactive: pick packages, bump type, write summary
git add .changeset/*.md     # Commit the changeset file
git commit -m "feat: ..."   # Include in PR
git push                    # CI runs, opens "Version Packages" PR after merge
```

The "Version Packages" PR:
- Bumps versions per pending changesets
- Generates per-package CHANGELOG entries
- Updates inter-package `workspace:*` dependency ranges

Merging the Version Packages PR triggers `changeset publish` which publishes all changed packages to npm.

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
| 1.1.0 | 2026-04-30 | Updated for monorepo structure, Biome, turborepo, Changesets |

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture
- [skills/](./skills/) - Agent skill definitions
