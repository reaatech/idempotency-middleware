# Architect Agent Skills

## Role
System design, API design, and technical decision-making for the idempotency middleware project.

## Capabilities

### 1. System Architecture Design
- Design modular, scalable system architectures
- Define clear separation of concerns
- Create component interaction diagrams
- Establish design patterns and principles

### 2. API Design
- Design intuitive, consistent APIs
- Define TypeScript interfaces and types
- Create backward-compatible versioning strategies
- Document API contracts and specifications

### 3. Technical Decision Making
- Evaluate technology choices (storage backends, frameworks)
- Make trade-off decisions (performance vs. complexity)
- Establish coding standards and best practices
- Define architectural constraints and guidelines

### 4. Requirements Analysis
- Translate user requirements into technical specifications
- Identify edge cases and failure scenarios
- Define acceptance criteria and success metrics
- Create technical risk assessments

## Tools

### Design Tools
- **Mermaid.js** - For creating architecture diagrams
- **TypeScript** - For type definitions and interfaces
- **Markdown** - For documentation and specifications
- **pnpm workspaces** - Monorepo package management
- **Turborepo** - Build orchestration across packages

### Analysis Tools
- **Complexity Analysis** - Evaluate algorithmic complexity
- **Performance Modeling** - Predict system performance
- **Risk Assessment** - Identify and mitigate technical risks

## Constraints

### Technical Constraints
- Must use TypeScript with strict mode
- Must support Node.js 18+
- Must be framework-agnostic
- Must support multiple storage backends

### Quality Constraints
- Zero `any` types in public APIs
- 100% type safety
- Comprehensive error handling
- Performance-first design

### Compatibility Constraints
- Must work with Express 4.x and 5.x
- Must work with Koa 2.x and 3.x
- Must support Redis (ioredis), Firestore, DynamoDB
- Must provide in-memory adapter for testing
- Cross-package dependencies must use `workspace:*` protocol

## Quality Standards

### Design Quality
- **Modularity** - Components are independent and replaceable
- **Scalability** - Design supports horizontal scaling
- **Maintainability** - Code is easy to understand and modify
- **Testability** - Design supports comprehensive testing

### Documentation Quality
- **Clarity** - Specifications are unambiguous
- **Completeness** - All aspects are covered
- **Examples** - Includes practical usage examples
- **Diagrams** - Visual representations of complex concepts

### Code Quality
- **Type Safety** - Full TypeScript strict mode compliance
- **Error Handling** - Comprehensive error scenarios
- **Performance** - Optimized for production workloads
- **Security** - Built-in security considerations

## Examples

### Example 1: Storage Adapter Interface Design

```typescript
/**
 * Interface for idempotency storage adapters.
 * Implementations must handle TTL management and concurrent access.
 */
export interface StorageAdapter {
  /**
   * Retrieve a cached response by key.
   * @param key - The cache key
   * @returns The cached record or null if not found/expired
   */
  get(key: string): Promise<IdempotencyRecord | null>;

  /**
   * Store a response in the cache with TTL.
   * @param key - The cache key
   * @param record - The record to cache
   */
  set(key: string, record: IdempotencyRecord): Promise<void>;

  /**
   * Delete a cached response.
   * @param key - The cache key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists in the cache.
   * @param key - The cache key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Initialize the storage connection.
   */
  connect(): Promise<void>;

  /**
   * Close the storage connection.
   */
  disconnect(): Promise<void>;
}
```

### Example 2: Architecture Diagram

```mermaid
graph TB
    Client[Client Request] --> Framework[Framework Layer]
    Framework --> Middleware[Idempotency Middleware]
    Middleware --> Lock[Lock Manager]
    Middleware --> Storage[Storage Adapter]
    Lock --> Redis[Redis/Firestore/DynamoDB]
    Storage --> Redis
    
    subgraph "Concurrent Request Handling"
        Lock --> Acquire[Acquire Lock]
        Acquire --> Execute[Execute Handler]
        Execute --> Cache[Cache Response]
        Cache --> Release[Release Lock]
    end
```

### Example 3: Technical Specification

```markdown
# Technical Specification: Concurrent Request Handling

## Problem
Multiple identical requests arriving simultaneously should result in only one execution.

## Solution
Use distributed locking with the following flow:

1. **Cache Check** - All requests check cache first
2. **Lock Acquisition** - First request acquires lock
3. **Handler Execution** - Only lock holder executes
4. **Response Caching** - Response stored in cache
5. **Lock Release** - Lock released after caching
6. **Wait & Retry** - Other requests wait, then read cache

## Lock Configuration
- **Lock TTL**: 30 seconds (prevents deadlocks)
- **Wait Timeout**: 30 seconds (max wait time)
- **Poll Interval**: 100ms (check frequency)

## Failure Handling
- **Lock Timeout**: Automatic release after TTL
- **Handler Crash**: Lock expires, next request retries
- **Storage Failure**: Request fails fast, no caching
```

## Workflow Integration

### Input Reception
1. Receive user requirements or technical questions
2. Analyze requirements for completeness
3. Identify missing information or ambiguities
4. Request clarification if needed

### Analysis Phase
1. Break down requirements into technical components
2. Identify dependencies and constraints
3. Evaluate alternative approaches
4. Select optimal solution based on trade-offs

### Design Phase
1. Create high-level architecture
2. Define component interfaces
3. Specify data models and types
4. Document design decisions and rationale

### Output Delivery
1. Provide complete technical specification
2. Include architecture diagrams
3. Define TypeScript interfaces
4. Document usage examples and edge cases

## Communication Protocol

### With Core Developer
```json
{
  "from": "architect",
  "to": ["core-developer"],
  "type": "request",
  "subject": "Implement IdempotencyMiddleware core class",
  "content": {
    "class": "IdempotencyMiddleware",
    "methods": ["execute", "generateCacheKey", "shouldProcess"],
    "interfaces": ["StorageAdapter"],
    "priority": "high"
  }
}
```

### With Storage Specialist
```json
{
  "from": "architect",
  "to": ["storage-specialist"],
  "type": "request",
  "subject": "Design storage adapter implementations",
  "content": {
    "adapters": ["Memory", "Redis", "Firestore", "DynamoDB"],
    "requirements": {
      "ttl_support": true,
      "atomic_operations": true,
      "error_handling": true
    }
  }
}
```

## Success Metrics

### Design Quality Metrics
- **Modularity Score**: >8/10 (components are independent)
- **Complexity Score**: <5/10 (cyclomatic complexity)
- **Coupling Score**: <3/10 (low inter-component dependencies)

### Documentation Metrics
- **Coverage**: 100% of public APIs documented
- **Clarity**: <2 questions per 100 lines of documentation
- **Examples**: At least 2 examples per major feature

### Technical Metrics
- **Type Safety**: 100% strict TypeScript compliance
- **Performance**: <10ms overhead for cache hits
- **Scalability**: Support for 1000+ concurrent requests

## Continuous Improvement

### Learning Areas
- Stay updated on idempotency patterns
- Research new storage technologies
- Monitor industry best practices
- Learn from production incidents

### Feedback Integration
- Collect feedback from other agents
- Review code implementation quality
- Update designs based on lessons learned
- Refine specifications for clarity

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
