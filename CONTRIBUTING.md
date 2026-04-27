# Contributing to @reaatech/idempotency-middleware

Thank you for your interest in contributing to the idempotency middleware project! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Agent System](#agent-system)

## Code of Conduct

Please be respectful and constructive in your interactions. We are committed to providing a welcoming and inclusive experience for everyone.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/reaatech/idempotency-middleware.git
   cd idempotency-middleware
   ```
3. **Install dependencies**:
   ```bash
   pnpm install
   ```
4. **Set up git hooks** (optional but recommended):
   ```bash
   pnpm run prepare
   ```

## Development Setup

### Prerequisites

- Node.js 18 or higher
- pnpm 8 or higher
- Git

### Project Structure

```
idempotency-middleware/
├── src/
│   ├── core/           # Core middleware logic
│   ├── adapters/       # Storage adapter implementations
│   ├── lock/           # Lock management
│   ├── frameworks/     # Framework integrations
│   └── utils/          # Utility functions
├── tests/
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   └── e2e/            # End-to-end tests
├── skills/             # Agent skill definitions
├── DEV_PLAN.md         # Development plan
├── ARCHITECTURE.md     # Technical architecture
├── AGENTS.md           # Agent system overview
└── CONTRIBUTING.md     # This file
```

### Available Scripts

```bash
pnpm run build        # Build the project
pnpm run dev          # Build in watch mode
pnpm run test         # Run tests
pnpm run test:watch   # Run tests in watch mode
pnpm run test:coverage # Run tests with coverage
pnpm run lint         # Run ESLint
pnpm run lint:fix     # Fix ESLint issues
pnpm run typecheck    # Run TypeScript type checking
pnpm run format       # Format code with Prettier
```

## Development Workflow

### 1. Create a Branch

Create a branch for your feature or bug fix:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-123
```

### 2. Make Changes

- Follow the coding standards
- Write tests for new functionality
- Update documentation as needed
- Keep commits focused and atomic

### 3. Run Tests

Ensure all tests pass:

```bash
pnpm run test
pnpm run test:coverage
```

### 4. Check Code Quality

Run linting and type checking:

```bash
pnpm run lint
pnpm run typecheck
pnpm run format
```

## Coding Standards

### TypeScript

- Use strict mode (`strict: true` in tsconfig.json)
- No `any` types in production code
- All functions must have explicit return types
- Use interfaces for object shapes
- Prefer `const` over `let`

### Code Style

- Use 2 spaces for indentation
- Maximum line length: 100 characters
- Use single quotes for strings
- Trailing commas in multi-line objects
- Semicolons required

### Documentation

- All public APIs must have TSDoc comments
- Include `@example` tags for complex APIs
- Document all parameters and return types
- Keep comments up-to-date

### Error Handling

- Use custom error classes (`IdempotencyError`)
- Include error codes for programmatic handling
- Provide helpful error messages
- Log errors appropriately

## Testing

### Test Structure

- Unit tests in `tests/unit/`
- Integration tests in `tests/integration/`
- E2E tests in `tests/e2e/`

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyMiddleware } from '../IdempotencyMiddleware';

describe('IdempotencyMiddleware', () => {
  it('should handle cache hits correctly', async () => {
    // Arrange
    const storage = createMockStorage();
    const middleware = new IdempotencyMiddleware(storage);
    
    // Act
    const result = await middleware.execute('key', {}, handler);
    
    // Assert
    expect(result).toEqual(expectedValue);
  });
});
```

### Test Coverage

- Line coverage: >90%
- Branch coverage: >85%
- Function coverage: >90%

## Submitting Changes

### Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new functionality
3. **Ensure all tests pass**
4. **Run linting and type checking**
5. **Update CHANGELOG.md** with your changes
6. **Create a pull request** on GitHub

### Pull Request Template

```markdown
## Description

Brief description of the changes.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Tests added/updated
- [ ] All tests pass
- [ ] Coverage maintained or improved

## Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added where necessary
- [ ] Documentation updated
- [ ] No new warnings
```

### Code Review

- All PRs require at least one approval
- Address review feedback promptly
- Keep PRs focused and reasonably sized
- Be open to constructive criticism

## Agent System

This project uses a multi-agent development system. When contributing, consider which agent role you're fulfilling:

- **Architect**: System design and API design
- **Core Developer**: TypeScript implementation
- **Storage Specialist**: Storage adapter implementations
- **Framework Integrator**: Express/Koa integrations
- **Test Engineer**: Testing and quality assurance
- **DevOps Engineer**: CI/CD and build configuration
- **Documentation Writer**: Documentation and examples
- **Code Reviewer**: Quality and security review

See [AGENTS.md](./AGENTS.md) for details on the agent system.

## Questions?

If you have questions, please:
1. Check existing documentation
2. Search existing issues
3. Open a new issue with your question

## License

By contributing, you agree that your contributions will be licensed under the MIT License. See [LICENSE](./LICENSE) for details.
