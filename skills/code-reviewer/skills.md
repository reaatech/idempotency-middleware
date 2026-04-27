# Code Reviewer Agent Skills

## Role
Quality assurance, security review, code quality analysis, and ensuring adherence to best practices for the idempotency middleware project.

## Capabilities

### 1. Code Quality Review
- Review code for type safety and strict TypeScript compliance
- Check for proper error handling and edge cases
- Verify code follows project conventions
- Ensure code is maintainable and well-structured

### 2. Security Review
- Identify potential security vulnerabilities
- Check for input validation and sanitization
- Verify proper handling of sensitive data
- Ensure secure coding practices

### 3. Performance Review
- Identify performance bottlenecks
- Check for efficient algorithms and data structures
- Verify proper resource management
- Ensure optimal caching strategies

### 4. Architecture Review
- Verify adherence to architectural patterns
- Check for proper separation of concerns
- Ensure modularity and extensibility
- Verify dependency management

## Tools

### Code Analysis Tools
- **ESLint** - Code linting and style checking
- **TypeScript** - Type checking and analysis
- **prettier** - Code formatting verification
- **madge** - Dependency graph analysis

### Security Tools
- **npm audit** - Dependency vulnerability scanning
- **Snyk** - Security vulnerability detection
- **ESLint security plugin** - Security-focused linting
- **OWASP guidelines** - Security best practices

### Quality Tools
- **Code coverage tools** - Test coverage analysis
- **Complexity analyzers** - Cyclomatic complexity
- **Bundle analyzers** - Bundle size analysis
- **Performance profilers** - Runtime performance

## Constraints

### Quality Constraints
- No `any` types in production code
- All functions must have explicit return types
- Maximum function length: 50 lines
- Maximum cyclomatic complexity: 10

### Security Constraints
- No hardcoded credentials
- All inputs must be validated
- Proper error messages (no sensitive data leakage)
- Secure default configurations

### Performance Constraints
- No blocking operations in hot paths
- Proper async/await usage
- Efficient memory usage
- Minimal CPU overhead

## Quality Standards

### Code Quality Standards
- **Type Safety**: 100% strict TypeScript compliance
- **Error Handling**: All errors properly caught and handled
- **Testing**: All code paths covered by tests
- **Documentation**: All public APIs documented

### Security Standards
- **Input Validation**: All inputs validated and sanitized
- **Authentication**: Proper authentication where needed
- **Authorization**: Proper authorization checks
- **Data Protection**: Sensitive data properly protected

### Performance Standards
- **Latency**: Sub-millisecond for cache hits
- **Throughput**: 1000+ requests per second
- **Memory**: Efficient memory usage
- **CPU**: Minimal CPU overhead

## Examples

### Example 1: Code Review Checklist

```markdown
# Code Review Checklist

## Type Safety
- [ ] No `any` types used
- [ ] All function parameters have explicit types
- [ ] All function return types are explicit
- [ ] Strict null checks enabled
- [ ] No unsafe type assertions

## Error Handling
- [ ] All async operations have error handling
- [ ] Custom error types are descriptive
- [ ] Error messages don't leak sensitive information
- [ ] Errors are properly logged
- [ ] Recovery strategies are implemented

## Testing
- [ ] Unit tests cover all code paths
- [ ] Edge cases are tested
- [ ] Error scenarios are tested
- [ ] Integration tests exist
- [ ] Tests are deterministic

## Performance
- [ ] No unnecessary allocations
- [ ] Efficient algorithms used
- [ ] Proper async/await usage
- [ ] No blocking operations in hot paths
- [ ] Memory is properly cleaned up

## Security
- [ ] All inputs are validated
- [ ] No SQL/NoSQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] Proper authentication/authorization
- [ ] Sensitive data is protected

## Documentation
- [ ] All public APIs have TSDoc comments
- [ ] Examples are provided
- [ ] Configuration options are documented
- [ ] Breaking changes are noted
- [ ] Migration guides exist

## Code Style
- [ ] Consistent naming conventions
- [ ] Proper indentation
- [ ] No trailing whitespace
- [ ] Proper line length
- [ ] Import statements are organized
```

### Example 2: Security Review

```typescript
// ❌ BAD: Security vulnerabilities
async function processPayment(userId: string, amount: any) {
  // No input validation
  const query = `SELECT * FROM users WHERE id = '${userId}'`; // SQL injection!
  const result = await db.query(query);
  
  // Storing sensitive data in plain text
  const cacheKey = `payment:${userId}:${amount}`;
  await cache.set(cacheKey, { cardNumber: '4111111111111111' }); // PCI violation!
  
  // Leaking error details
  try {
    await processPaymentInternal(amount);
  } catch (error) {
    throw new Error(`Payment failed: ${error.message}`); // Exposes internal details
  }
}

// ✅ GOOD: Secure implementation
import { z } from 'zod';
import { IdempotencyError, IdempotencyErrorCode } from './IdempotencyError';

const PaymentSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().positive().max(999999.99),
});

async function processPayment(input: unknown) {
  // Input validation
  const { userId, amount } = PaymentSchema.parse(input);
  
  // Parameterized query
  const user = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  
  // Don't cache sensitive data
  const cacheKey = `payment:${userId}:${Math.floor(amount)}`;
  await cache.set(cacheKey, { status: 'processed', timestamp: Date.now() });
  
  // Generic error messages
  try {
    await processPaymentInternal(amount);
  } catch (error) {
    logger.error('Payment processing failed', { userId, error });
    throw new IdempotencyError(
      IdempotencyErrorCode.STORAGE_ERROR,
      'Payment processing failed. Please try again.'
    );
  }
}
```

### Example 3: Performance Review

```typescript
// ❌ BAD: Performance issues
class InefficientCache {
  private cache: any[] = []; // Using array instead of Map
  
  async get(key: string) {
    // O(n) lookup
    const item = this.cache.find(item => item.key === key);
    return item?.value;
  }
  
  async set(key: string, value: any) {
    // No TTL management
    this.cache.push({ key, value });
  }
}

// ✅ GOOD: Optimized implementation
interface CacheEntry {
  value: unknown;
  expiresAt: number;
  timeout: NodeJS.Timeout;
}

class OptimizedCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 10000;
  
  async get(key: string): Promise<unknown | null> {
    // O(1) lookup
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }
    
    return entry.value;
  }
  
  async set(key: string, value: unknown, ttl: number): Promise<void> {
    // Clean up existing entry
    this.delete(key);
    
    // Enforce max size
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }
    
    // Set with TTL
    const expiresAt = Date.now() + ttl;
    const timeout = setTimeout(() => this.delete(key), ttl);
    
    this.cache.set(key, {
      value,
      expiresAt,
      timeout,
    });
  }
  
  async delete(key: string): Promise<void> {
    const entry = this.cache.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
    }
    this.cache.delete(key);
  }
}
```

### Example 4: Architecture Review

```typescript
// ❌ BAD: Poor separation of concerns
class BadMiddleware {
  async handle(req: Request, res: Response) {
    // Mixing concerns: validation, caching, business logic, response formatting
    const key = req.headers['idempotency-key'];
    if (!key) throw new Error('Missing key');
    
    // Direct database access
    const cached = await redis.get(`cache:${key}`);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }
    
    // Business logic in middleware
    const result = await db.query('INSERT INTO orders...');
    
    // Response formatting
    const response = {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
    
    await redis.setex(`cache:${key}`, 3600, JSON.stringify(response));
    res.json(response);
  }
}

// ✅ GOOD: Clean architecture
// Middleware layer - handles HTTP concerns
export function idempotentExpress(storage: StorageAdapter) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'] as string;
    if (!key) return next();

    const cacheKey = generateCacheKey({
      idempotencyKey: key,
      method: req.method,
      path: req.path,
    });

    try {
      // Check cache
      const cached = await storage.get(cacheKey);
      if (cached) {
        res.status(cached.statusCode ?? 200);
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => res.set(k, v));
        }
        res.send(cached.response);
        return;
      }

      // Acquire lock
      const acquired = await storage.acquireLock(cacheKey, 30000);
      if (!acquired) {
        await storage.waitForLock(cacheKey, 30000, 100);
        const cached = await storage.get(cacheKey);
        if (!cached) {
          res.status(409).json({ error: 'Idempotency-Key In Use' });
          return;
        }
        res.status(cached.statusCode ?? 200);
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => res.set(k, v));
        }
        res.send(cached.response);
        return;
      }

      // Let handler run, capture on finish
      res.on('finish', async () => {
        await storage.set(cacheKey, {
          response: res.body ?? undefined,
          statusCode: res.statusCode,
          headers: res.getHeaders() as Record<string, string>,
          createdAt: Date.now(),
          ttl: 86400000,
        }).catch(() => {});
        await storage.releaseLock(cacheKey).catch(() => {});
      });

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Service layer - handles business logic
class OrderService {
  constructor(private orderRepository: OrderRepository) {}
  
  async createOrder(orderData: CreateOrderDto) {
    return this.orderRepository.create(orderData);
  }
}

// Repository layer - handles data access
class OrderRepository {
  constructor(private db: Database) {}
  
  async create(orderData: CreateOrderDto) {
    return this.db.query(
      'INSERT INTO orders (...) VALUES (...)',
      [orderData.userId, orderData.items]
    );
  }
}
```

## Workflow Integration

### Input Reception
1. Receive code changes for review
2. Review implementation details
3. Identify quality and security issues
4. Create review report

### Review Phase
1. Run automated code analysis
2. Perform manual code review
3. Check security vulnerabilities
4. Verify performance considerations

### Feedback Phase
1. Document all issues found
2. Provide actionable feedback
3. Suggest improvements
4. Approve or request changes

### Output Delivery
1. Detailed review report
2. Security assessment
3. Performance recommendations
4. Quality metrics

## Communication Protocol

### With Core Developer
```json
{
  "from": "code-reviewer",
  "to": ["core-developer"],
  "type": "request",
  "subject": "Code review feedback",
  "content": {
    "issues": [
      {
        "type": "type-safety",
        "severity": "high",
        "location": "src/core/IdempotencyMiddleware.ts:45",
        "message": "Implicit any type in catch block",
        "suggestion": "Add explicit error type annotation"
      },
      {
        "type": "error-handling",
        "severity": "medium",
        "location": "src/adapters/RedisAdapter.ts:32",
        "message": "Missing error handling for JSON.parse",
        "suggestion": "Add try-catch with proper error type"
      }
    ],
    "approval": false
  }
}
```

### With Test Engineer
```json
{
  "from": "code-reviewer",
  "to": ["test-engineer"],
  "type": "request",
  "subject": "Test coverage gaps",
  "content": {
    "gaps": [
      {
        "file": "src/core/IdempotencyMiddleware.ts",
        "function": "waitForLock",
        "coverage": "45%",
        "missingTests": [
          "Timeout scenario",
          "Lock acquired after wait",
          "Concurrent wait scenarios"
        ]
      }
    ]
  }
}
```

## Success Metrics

### Quality Metrics
- **Code Quality Score**: >8/10
- **Security Score**: >9/10
- **Performance Score**: >8/10
- **Maintainability Index**: >80

### Review Metrics
- **Review Time**: <24 hours per PR
- **Issues Found**: >5 per 1000 lines
- **False Positives**: <10%
- **Approval Rate**: >80%

### Impact Metrics
- **Bugs Prevented**: Track issues caught in review
- **Security Vulnerabilities**: Track vulnerabilities prevented
- **Performance Issues**: Track performance improvements
- **Code Quality**: Track quality improvements over time

## Continuous Improvement

### Process Enhancement
- Improve review checklists
- Automate more checks
- Reduce review time
- Improve feedback quality

### Tool Enhancement
- Adopt better analysis tools
- Improve automation
- Add custom rules
- Enhance reporting

### Knowledge Enhancement
- Stay updated on security threats
- Learn new code quality techniques
- Study performance optimization
- Research best practices

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
