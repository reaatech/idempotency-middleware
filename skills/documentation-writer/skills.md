# Documentation Writer Agent Skills

## Role
Creating comprehensive documentation, API references, examples, and guides for the idempotency middleware project.

## Capabilities

### 1. API Documentation
- Write TSDoc comments for all public APIs
- Create comprehensive API reference documentation
- Document configuration options and parameters
- Provide usage examples for each API

### 2. User Guides
- Write quick start guides
- Create setup and installation guides
- Document configuration options
- Provide troubleshooting guides

### 3. Examples and Tutorials
- Create working code examples
- Write step-by-step tutorials
- Provide integration examples for each framework
- Document common use cases

### 4. Technical Writing
- Write clear, concise documentation
- Create architecture diagrams
- Document best practices
- Maintain documentation consistency

## Tools

### Documentation Tools
- **TypeDoc** - Automated API documentation
- **Markdown** - Documentation format
- **Mermaid.js** - Diagram creation
- **Docusaurus** - Documentation site generator

### Code Tools
- **TypeScript** - For type-safe examples
- **tsx** - For running TypeScript examples
- **Biome** - Code formatting and linting
- **pnpm workspaces** - Monorepo references in examples

## Constraints

### Documentation Constraints
- All public APIs must be documented
- Examples must be tested and working
- Documentation must be up-to-date
- Must support multiple frameworks

### Quality Constraints
- Clear and concise writing
- Consistent terminology
- Proper grammar and spelling
- Accessible to all skill levels

### Maintenance Constraints
- Documentation must be versioned
- Examples must be maintained
- Breaking changes must be documented
- Migration guides for major versions

## Quality Standards

### Content Quality
- **Clarity**: Easy to understand
- **Completeness**: All aspects covered
- **Accuracy**: Technically correct
- **Consistency**: Uniform style and tone

### Technical Quality
- **Working Examples**: All code examples run
- **Type Safety**: Examples are type-safe
- **Best Practices**: Follow industry standards
- **Security**: Secure coding practices

### User Experience
- **Navigation**: Easy to find information
- **Searchability**: Searchable content
- **Readability**: Easy to read
- **Accessibility**: Accessible to all users

## Examples

### Example 1: TSDoc Comments

```typescript
/**
 * Configuration options for idempotency middleware.
 *
 * @example
 * ```typescript
 * import { createIdempotencyMiddleware } from '@reaatech/idempotency-middleware';
 *
 * const config: IdempotencyConfig = {
 *   headerName: 'X-Idempotency-Key',
 *   ttl: 3600000, // 1 hour
 *   methods: ['POST', 'PUT'],
 * };
 *
 * const middleware = createIdempotencyMiddleware(storage, config);
 * ```
 */
export interface IdempotencyConfig {
  /**
   * The header name to extract the idempotency key from.
   * The key extraction is case-insensitive.
   *
   * @default 'Idempotency-Key'
   * @example 'X-Idempotency-Key'
   */
  headerName?: string;

  /**
   * Time-to-live for cached responses in milliseconds.
   * After this period, the cached response will be considered expired.
   *
   * @default 86400000 // 24 hours
   * @minimum 60000 // 1 minute
   * @maximum 604800000 // 7 days
   */
  ttl?: number;

  /**
   * HTTP methods to apply idempotency to.
   * Requests with methods not in this list will bypass the middleware.
   *
   * @default ['POST', 'PUT', 'PATCH']
   */
  methods?: string[];

  /**
   * Custom function to extract the idempotency key from the request.
   * If not provided, the key will be extracted from the header specified
   * by `headerName`.
   *
   * @param request - The incoming request object
   * @returns The idempotency key, or undefined if not found
   */
  getKey?: (request: unknown) => string | undefined;

  /**
   * Custom function to determine if a response should be cached.
   * Return `true` to cache the response, `false` to skip caching.
   *
   * @param response - The response object from the handler
   * @returns Whether to cache the response
   *
   * @example
   * ```typescript
   * shouldCache: (response) => {
   *   // Only cache successful responses
   *   return response.statusCode >= 200 && response.statusCode < 300;
   * }
   * ```
   */
  shouldCache?: (response: unknown) => boolean;

  /**
   * Additional headers to include in the cache key.
   * Use this when the response varies based on specific headers.
   *
   * @default []
   * @example ['Accept-Language', 'Accept-Encoding']
   */
  varyHeaders?: string[];

  /**
   * Maximum time to wait for a lock in milliseconds.
   * If a lock cannot be acquired within this time, an error is thrown.
   *
   * @default 30000 // 30 seconds
   */
  lockTimeout?: number;

  /**
   * Interval between lock acquisition attempts in milliseconds.
   *
   * @default 100
   */
  lockPollInterval?: number;
}
```

### Example 2: README.md

```markdown
# @reaatech/idempotency-middleware

Framework-agnostic idempotency cache middleware for TypeScript applications. Prevents duplicate execution of operations when clients retry requests.

## Features

- 🔄 **Concurrent Request Handling** - Prevents race conditions with distributed locking
- 💾 **Multiple Storage Backends** - Redis, Firestore, DynamoDB, or in-memory
- 🌐 **Framework Agnostic** - Works with Express, Koa, or any Node.js framework
- ⏰ **TTL Management** - Automatic cache expiration
- 🛡️ **Type-Safe** - Full TypeScript support with strict mode

## Installation

```bash
npm install @reaatech/idempotency-middleware
# or
pnpm add @reaatech/idempotency-middleware
# or
yarn add @reaatech/idempotency-middleware
```

## Quick Start

### Express

```typescript
import express from 'express';
import { idempotentExpress } from '@reaatech/idempotency-middleware/express';
import { MemoryAdapter } from '@reaatech/idempotency-middleware';

const app = express();
const storage = new MemoryAdapter();

app.use(express.json());
app.use(idempotentExpress(storage, { ttl: 3600000 }));

app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body);
  res.status(201).json(user);
});
```

### Koa

```typescript
import Koa from 'koa';
import { idempotentKoa } from '@reaatech/idempotency-middleware/koa';
import { MemoryAdapter } from '@reaatech/idempotency-middleware';

const app = new Koa();
const storage = new MemoryAdapter();

app.use(idempotentKoa(storage, { ttl: 3600000 }));

app.use(async (ctx) => {
  if (ctx.path === '/api/users' && ctx.method === 'POST') {
    ctx.body = await createUser(ctx.request.body);
    ctx.status = 201;
  }
});
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headerName` | `string` | `'Idempotency-Key'` | Header to extract idempotency key from |
| `ttl` | `number` | `86400000` (24h) | Cache TTL in milliseconds |
| `methods` | `string[]` | `['POST', 'PUT', 'PATCH']` | HTTP methods to apply idempotency to |
| `varyHeaders` | `string[]` | `[]` | Headers to include in cache key |
| `lockTimeout` | `number` | `30000` (30s) | Lock acquisition timeout |

## Storage Adapters

### Redis

```typescript
import Redis from 'ioredis';
import { RedisAdapter } from '@reaatech/idempotency-middleware';

const redis = new Redis('redis://localhost:6379');
const storage = new RedisAdapter(redis);
```

### Firestore

```typescript
import { Firestore } from '@google-cloud/firestore';
import { FirestoreAdapter } from '@reaatech/idempotency-middleware';

const firestore = new Firestore();
const storage = new FirestoreAdapter(firestore);
```

### DynamoDB

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBAdapter } from '@reaatech/idempotency-middleware';

const client = new DynamoDBClient({ region: 'us-east-1' });
const storage = new DynamoDBAdapter(client, 'idempotency-cache');
```

## How It Works

1. Client sends request with `Idempotency-Key` header
2. Middleware generates cache key from idempotency key + request details
3. If cached response exists, return it immediately
4. If not, acquire lock and execute handler
5. Store response in cache and release lock
6. Concurrent requests wait for lock, then return cached response

## License

MIT
```

### Example 3: Tutorial - Handling Concurrent Requests

```markdown
# Tutorial: Handling Concurrent Requests

This tutorial demonstrates how the middleware handles concurrent duplicate requests.

## The Problem

When a client sends the same request multiple times (due to network issues or UI bugs), you want to:

1. Execute the operation only once
2. Return the same response to all duplicate requests
3. Prevent race conditions

## The Solution

The idempotency middleware uses distributed locking to ensure only one request executes the handler, while others wait and receive the cached response.

## Example Scenario

Let's say you have a payment processing endpoint:

```typescript
import express from 'express';
import { idempotentExpress } from '@reaatech/idempotency-middleware/express';
import { RedisAdapter } from '@reaatech/idempotency-middleware';

const app = express();
const redis = new Redis();
const storage = new RedisAdapter(redis);

app.use(express.json());
app.use(idempotentExpress(storage, { ttl: 3600000 }));

app.post('/api/payments', async (req, res) => {
  const { amount, recipient } = req.body;
  
  // This will only execute once, even if called multiple times
  const payment = await processPayment(amount, recipient);
  
  res.json(payment);
});
```

## Testing Concurrent Requests

You can test this with multiple simultaneous requests:

```typescript
import fetch from 'node-fetch';

const idempotencyKey = 'payment-123';
const payload = { amount: 100, recipient: 'user@example.com' };

// Send 3 identical requests simultaneously
const responses = await Promise.all([
  fetch('http://localhost:3000/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  }),
  fetch('http://localhost:3000/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  }),
  fetch('http://localhost:3000/api/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  }),
]);

// All responses will be identical
const results = await Promise.all(responses.map(r => r.json()));
console.log(results[0] === results[1]); // true
console.log(results[1] === results[2]); // true
```

## Key Points

- Only one payment is processed
- All requests receive the same response
- No race conditions or duplicate charges
```

## Workflow Integration

### Input Reception
1. Receive component specifications
2. Review implementation details
3. Identify documentation needs
4. Create documentation plan

### Documentation Phase
1. Write API documentation
2. Create user guides
3. Develop code examples
4. Build tutorials

### Review Phase
1. Technical review for accuracy
2. Copy editing for clarity
3. Example testing for correctness
4. Final review and approval

### Output Delivery
1. Complete API documentation
2. User guides and tutorials
3. Working code examples
4. Documentation site

## Communication Protocol

### With Core Developer
```json
{
  "from": "documentation-writer",
  "to": ["core-developer"],
  "type": "request",
  "subject": "API documentation requirements",
  "content": {
    "requirements": {
      "tsdoc": "All public APIs must have TSDoc comments",
      "examples": "Each API needs at least one usage example",
      "parameters": "All parameters must be documented with types"
    }
  }
}
```

### With Framework Integrator
```json
{
  "from": "documentation-writer",
  "to": ["framework-integrator"],
  "type": "request",
  "subject": "Framework integration examples",
  "content": {
    "requirements": {
      "express": "Complete Express integration example",
      "koa": "Complete Koa integration example",
      "raw": "Raw handler wrapper example"
    }
  }
}
```

## Success Metrics

### Documentation Metrics
- **Coverage**: 100% of public APIs documented
- **Examples**: At least 2 examples per major feature
- **Tutorials**: Step-by-step guides for common use cases
- **Clarity**: <2 questions per 100 readers

### Quality Metrics
- **Accuracy**: 100% technically correct
- **Working Code**: All examples tested and working
- **Consistency**: Uniform style and terminology
- **Accessibility**: Readable by all skill levels

### User Experience Metrics
- **Findability**: Easy to find information
- **Readability**: Clear and concise writing
- **Completeness**: All questions answered
- **Satisfaction**: High user satisfaction scores

## Continuous Improvement

### Content Enhancement
- Add more examples
- Improve explanations
- Update for new features
- Add video tutorials

### Process Improvement
- Automate documentation generation
- Improve review process
- Enhance example testing
- Streamline updates

### Tool Enhancement
- Adopt better documentation tools
- Improve search functionality
- Add interactive examples
- Enhance API reference generation

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
