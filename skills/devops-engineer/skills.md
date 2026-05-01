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
- **tsup 8** - Fast TypeScript bundler (per-package: `tsup src/index.ts --format cjs,esm --dts --clean`)
- **TypeScript 5.8** - Language compiler with strict mode
- **Biome 1.9** - Code linting and formatting
- **Turborepo 2** - Monorepo build orchestration (`turbo run build`)

### CI/CD Tools
- **GitHub Actions** - CI/CD automation
- **pnpm 10** - Package manager with workspaces
- **Changesets** - Versioning and CHANGELOG generation
- **npm** - Package publishing (with provenance)

### Infrastructure Tools
- **Node.js 18+** - Runtime environment
- **pnpm workspaces** - Monorepo dependency linking

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

### Example 1: Monorepo Build Configuration

```bash
# Each package uses the same build command:
# packages/*/package.json → "build": "tsup src/index.ts --format cjs,esm --dts --clean"

# Root turbo.json orchestrates:
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}

# Build all packages in dependency order:
pnpm run build   # → turbo run build
```

Each package produces:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CJS)
- `dist/index.d.ts` / `dist/index.d.cts` (TypeScript declarations)
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

env:
  NODE_VERSION: 22

jobs:
  install:
    name: Install Dependencies
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

  format:
    name: Code Format
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile --prefer-offline
      - run: pnpm biome format --write . && git diff --exit-code

  lint:
    name: Lint
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile --prefer-offline
      - run: pnpm lint

  typecheck:
    name: Type Check
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile --prefer-offline
      - run: pnpm typecheck

  build:
    name: Build
    needs: [lint, typecheck]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile --prefer-offline
      - run: pnpm build
```

### Example 3: GitHub Actions Release Workflow (Changesets)

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

env:
  NODE_VERSION: 22

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
      packages: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm release
          version: pnpm version-packages
          commit: 'chore(release): version packages'
          title: 'chore(release): version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: 'true'
```

### Example 4: Per-Package package.json (Monorepo)

```json
{
  "name": "@reaatech/idempotency-middleware-adapter-redis",
  "version": "1.0.0",
  "description": "Redis storage adapter for @reaatech/idempotency-middleware",
  "license": "MIT",
  "author": "Rick Somers <rick@reaatech.com> (https://reaatech.com)",
  "repository": {
    "type": "git",
    "url": "https://github.com/reaatech/idempotency-middleware.git",
    "directory": "packages/adapter-redis"
  },
  "homepage": "https://github.com/reaatech/idempotency-middleware/tree/main/packages/adapter-redis#readme",
  "bugs": {
    "url": "https://github.com/reaatech/idempotency-middleware/issues"
  },
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@reaatech/idempotency-middleware": "workspace:*",
    "ioredis": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.1"
  },
  "engines": {
    "node": ">=18"
  }
}
```

Key monorepo patterns:
- `"directory"` in `repository` tells npm the subdirectory
- `"workspace:*"` for cross-package dependencies
- `"publishConfig": { "access": "public" }` required for scoped packages
- Build/Test commands are per-package; Turborepo orchestrates
- `types` comes first in exports (required by Node.js/TypeScript resolution order)

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
