# Development Guide

## Prerequisites

- Node.js >= 20.19
- pnpm >= 9 (will be installed via corepack)
- Git

## Initial Setup

```bash
# Clone the repository
git clone https://github.com/cmwen/min-node-app-template.git
cd min-node-app-template

# Enable corepack (includes pnpm)
corepack enable

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Development Workflow

### Running in Development Mode

```bash
# Build and watch for changes (in separate terminals)
cd packages/core && pnpm build --watch
cd packages/cli && pnpm build --watch
cd packages/web && pnpm build --watch
cd packages/mcp && pnpm build --watch
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
cd packages/cli && pnpm build

# Clean and rebuild
pnpm clean && pnpm build
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run tests for specific package
cd packages/core && pnpm test

# Run with coverage
pnpm test -- --coverage
```

### Linting and Formatting

```bash
# Check and fix linting issues
pnpm lint

# Check only (CI mode)
pnpm lint:ci

# Format code
pnpm format

# Check formatting only
pnpm format:check
```

## Package Development

### Creating a New Package

```bash
# Create package directory
mkdir packages/my-package
cd packages/my-package

# Create package.json
cat > package.json << EOF
{
  "name": "@my-scope/my-package",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@my-scope/core": "workspace:*"
  }
}
EOF

# Create TypeScript config
cat > tsconfig.json << EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules"]
}
EOF

# Create source and test directories
mkdir src test
```

### Working with Workspace Dependencies

```bash
# Add dependency to another workspace package
pnpm add @my-scope/core --workspace --filter my-package

# Update all workspace dependencies
pnpm install

# Check for outdated dependencies
pnpm outdated
```

## Debugging

### VSCode Debugging

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/packages/cli/dist/index.js",
      "args": ["--help"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    }
  ]
}
```

### Command-line Debugging

```bash
# Run with Node debugger
node --inspect-brk packages/cli/dist/index.js

# Run tests with debugger
node --inspect-brk node_modules/vitest/vitest.mjs run
```

## Common Tasks

### Adding a New Feature

1. Create feature branch: `git checkout -b feature/my-feature`
2. Implement in Core package
3. Add tests
4. Expose through CLI/Web/MCP as needed
5. Update documentation
6. Submit PR

### Updating Dependencies

```bash
# Update all dependencies (interactive)
pnpm update --interactive --recursive

# Update specific dependency
pnpm update package-name

# Update to latest (breaking changes)
pnpm update --latest package-name
```

### Publishing

See the automated release workflow in `.github/workflows/release.yml`.

Manual publishing:
```bash
# Update version
cd packages/cli
npm version patch  # or minor, major

# Build and test
cd ../..
pnpm build
pnpm test

# Create tag and push
git tag v1.0.0
git push origin v1.0.0
# CI will automatically publish
```

## Troubleshooting

### Build Errors

```bash
# Clean all build artifacts
pnpm clean

# Remove node_modules and reinstall
rm -rf node_modules packages/*/node_modules
pnpm install

# Rebuild
pnpm build
```

### Test Failures

```bash
# Run tests in verbose mode
pnpm test -- --reporter=verbose

# Run single test file
pnpm test -- path/to/test.test.ts

# Update snapshots
pnpm test -- -u
```

### Type Errors

```bash
# Check types without building
pnpm exec tsc --noEmit

# Check specific package
cd packages/cli
pnpm exec tsc --noEmit
```

## Tips

- Use `pnpm` instead of `npm` or `yarn`
- Run builds frequently to catch errors early
- Write tests as you develop
- Keep commits small and focused
- Use conventional commit messages
- Update documentation with code changes
