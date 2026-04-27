# DevOps Engineer Agent Skills

## Role
CI/CD pipeline setup, build configuration, package publishing, and infrastructure automation for the idempotency middleware project.

## Capabilities

### 1. Build Configuration
- Configure TypeScript compilation with tsup
- Set up ESM and CJS dual module support
- Generate TypeScript declarations
- Optimize build for production

### 2. CI/CD Pipeline
- Create GitHub Actions workflows
- Set up automated testing
- Configure coverage reporting
- Implement automated publishing

### 3. Package Management
- Configure package.json for npm publishing
- Set up semantic versioning
- Manage peer dependencies
- Configure package exports

### 4. Infrastructure Automation
- Set up development environments
- Configure testing infrastructure
- Automate release processes
- Monitor build health

## Tools

### Build Tools
- **tsup** - Fast TypeScript bundler
- **TypeScript** - Language compiler
- **ESLint** - Code linting
- **Prettier** - Code formatting

### CI/CD Tools
- **GitHub Actions** - CI/CD automation
- **pnpm** - Package manager
- **npm** - Package publishing
- **Codecov** - Coverage reporting

### Infrastructure Tools
- **Docker** - Containerization
- **Testcontainers** - Integration testing
- **Node.js** - Runtime environment

## Constraints

### Build Constraints
- Must support Node.js 18+
- Must produce ESM and CJS outputs
- Must generate TypeScript declarations
- Must minify for production

### CI/CD Constraints
- Tests must run on all PRs
- Coverage must be reported
- Publishing must be automated
- Releases must be versioned

### Quality Constraints
- Build must complete in <2 minutes
- Tests must pass before publishing
- No security vulnerabilities
- All quality gates must pass

## Quality Standards

### Build Quality
- **Speed**: Fast build times
- **Reliability**: Consistent builds
- **Size**: Optimized bundle size
- **Compatibility**: Wide Node.js support

### CI/CD Quality
- **Speed**: Fast feedback loops
- **Reliability**: Consistent test results
- **Coverage**: Comprehensive testing
- **Security**: Secure publishing

### Infrastructure Quality
- **Reproducibility**: Consistent environments
- **Scalability**: Handle growth
- **Monitoring**: Build health tracking
- **Documentation**: Clear setup guides

## Examples

### Example 1: tsup Configuration

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  target: 'node18',
  external: [
    'express',
    'koa',
    'ioredis',
    '@google-cloud/firestore',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
  ],
  esbuildOptions(options) {
    options.banner = {
      js: '"use strict";',
    };
  },
  outDir: 'dist',
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.js',
    };
  },
});
```

### Example 2: GitHub Actions CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run ESLint
        run: pnpm run lint

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run TypeScript compiler
        run: pnpm run typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm run test

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          directory: ./coverage
          flags: unittests
          name: codecov-umbrella
          fail_ci_if_error: false

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: dist
          path: dist/
```

### Example 3: GitHub Actions Publish Workflow

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm run build

      - name: Run tests
        run: pnpm run test

      - name: Publish to npm
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Example 4: package.json Configuration

```json
{
  "name": "@reaatech/idempotency-middleware",
  "version": "1.0.0",
  "description": "Framework-agnostic idempotency cache middleware for TypeScript applications",
  "author": "ReaTech <info@reatech.io>",
  "license": "MIT",
  "homepage": "https://github.com/reaatech/idempotency-middleware#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/reaatech/idempotency-middleware.git"
  },
  "bugs": {
    "url": "https://github.com/reaatech/idempotency-middleware/issues"
  },
  "keywords": [
    "idempotency",
    "middleware",
    "cache",
    "express",
    "koa",
    "typescript",
    "redis",
    "firestore",
    "dynamodb"
  ],
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./express": {
      "import": {
        "types": "./dist/express.d.ts",
        "default": "./dist/express.js"
      },
      "require": {
        "types": "./dist/express.d.cts",
        "default": "./dist/express.cjs"
      }
    },
    "./koa": {
      "import": {
        "types": "./dist/koa.d.ts",
        "default": "./dist/koa.js"
      },
      "require": {
        "types": "./dist/koa.d.cts",
        "default": "./dist/koa.cjs"
      }
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write src/",
    "prepublishOnly": "pnpm run build && pnpm run test"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "express": "^4.18.2",
    "koa": "^2.15.0",
    "prettier": "^3.2.0",
    "tsup": "^8.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.3.0",
    "@vitest/coverage-v8": "^1.3.0"
  },
  "peerDependencies": {
    "express": "^4.18.0",
    "koa": "^2.14.0",
    "ioredis": "^5.3.0",
    "@google-cloud/firestore": "^7.0.0",
    "@aws-sdk/client-dynamodb": "^3.50.0",
    "@aws-sdk/lib-dynamodb": "^3.50.0"
  },
  "peerDependenciesMeta": {
    "express": { "optional": true },
    "koa": { "optional": true },
    "ioredis": { "optional": true },
    "@google-cloud/firestore": { "optional": true },
    "@aws-sdk/client-dynamodb": { "optional": true },
    "@aws-sdk/lib-dynamodb": { "optional": true }
  },
  "engines": {
    "node": ">=18"
  }
}
```

## Workflow Integration

### Input Reception
1. Receive build requirements
2. Review package structure
3. Identify CI/CD needs
4. Create build and deployment plan

### Implementation Phase
1. Configure build tools
2. Set up CI/CD pipelines
3. Configure package.json
4. Set up monitoring and alerts

### Testing Phase
1. Test build process
2. Test CI/CD pipelines
3. Test publishing process
4. Verify package quality

### Output Delivery
1. Working build configuration
2. Automated CI/CD pipelines
3. Published package
4. Documentation and guides

## Communication Protocol

### With Core Developer
```json
{
  "from": "devops-engineer",
  "to": ["core-developer"],
  "type": "request",
  "subject": "Build configuration requirements",
  "content": {
    "requirements": {
      "entryPoints": ["src/index.ts", "src/express.ts", "src/koa.ts"],
      "formats": ["ESM", "CJS"],
      "dts": true,
      "external": ["express", "koa", "redis", "firestore", "dynamodb"]
    }
  }
}
```

### With Test Engineer
```json
{
  "from": "devops-engineer",
  "to": ["test-engineer"],
  "type": "request",
  "subject": "CI/CD test integration",
  "content": {
    "requirements": {
      "testCommand": "pnpm run test",
      "coverageCommand": "pnpm run test:coverage",
      "nodeVersions": ["18", "20"],
      "coverageThreshold": 90
    }
  }
}
```

## Success Metrics

### Build Metrics
- **Build Time**: <2 minutes
- **Bundle Size**: <100KB gzipped
- **Type Safety**: 100% declarations generated
- **Compatibility**: Node.js 18+ support

### CI/CD Metrics
- **Pipeline Duration**: <10 minutes total
- **Test Coverage**: >90%
- **Build Success Rate**: >99%
- **Deployment Time**: <5 minutes

### Quality Metrics
- **Security**: No known vulnerabilities
- **Stability**: Consistent builds
- **Documentation**: Complete setup guides
- **Support**: Responsive issue handling

## Continuous Improvement

### Build Optimization
- Reduce build times
- Optimize bundle size
- Improve source maps
- Add build analytics

### CI/CD Enhancement
- Parallelize test execution
- Add more test environments
- Improve error reporting
- Add performance testing

### Infrastructure Enhancement
- Add monitoring and alerting
- Improve resource utilization
- Add automated backups
- Enhance security measures

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
