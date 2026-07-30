# Contributing Guide

This guide is for contributors working on this template or projects based on it.

## Setting Up Development Environment

### Prerequisites

- Node.js >= 20.19
- pnpm >= 9 (installed via corepack)
- Git
- A code editor (VS Code recommended)

### Using Devcontainer (Recommended)

If using VS Code with Docker:

1. Install the "Dev Containers" extension
2. Open the project in VS Code
3. Press F1 and select "Dev Containers: Reopen in Container"
4. Wait for the container to build and dependencies to install

The devcontainer includes:
- Node.js 20 or 22
- pnpm configured
- Recommended VS Code extensions
- Git and GitHub CLI

### Manual Setup

```bash
# Clone the repository
git clone https://github.com/cmwen/min-node-app-template.git
cd min-node-app-template

# Enable corepack and activate pnpm
corepack enable
corepack prepare pnpm@10.15.1 --activate

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Development Workflow

### Making Changes

1. **Create a branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes:**
   - Edit source files in `packages/*/src/`
   - Add/update tests in `packages/*/test/`
   - Update documentation as needed

3. **Build and test:**
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   ```

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Push and create PR:**
   ```bash
   git push origin feature/my-feature
   # Create PR on GitHub
   ```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run tests for specific package
cd packages/core
pnpm test

# Run with coverage
pnpm test -- --coverage
```

### Code Style

This project uses Biome for linting and formatting:

```bash
# Check and fix issues
pnpm lint

# Check only (for CI)
pnpm lint:ci

# Format code
pnpm format

# Check formatting
pnpm format:check
```

### Building

```bash
# Build all packages
pnpm build

# Clean build artifacts
pnpm clean

# Build specific package
cd packages/cli
pnpm build

# Build CLI bundle
cd packages/cli
pnpm build:bundle
```

## Project Structure

### Monorepo Organization

```
packages/
├── core/      # Shared business logic
├── cli/       # Command-line interface
├── web/       # Web application
└── mcp/       # MCP server for AI
```

### Package Dependencies

- `cli`, `web`, `mcp` depend on `core`
- `core` should remain framework-agnostic
- Workspace dependencies use `workspace:*`

### Adding a New Package

1. Create directory structure:
   ```bash
   mkdir -p packages/my-package/{src,test}
   ```

2. Add `package.json`:
   ```json
   {
     "name": "@template/my-package",
     "version": "0.1.0",
     "type": "module",
     "main": "dist/index.js",
     "scripts": {
       "build": "tsc -b",
       "test": "vitest run"
     },
     "dependencies": {
       "@template/core": "workspace:*"
     }
   }
   ```

3. Add `tsconfig.json`:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "dist",
       "rootDir": "src"
     },
     "include": ["src/**/*"],
     "references": [{ "path": "../core" }]
   }
   ```

4. Add source files and tests
5. Update root workspace if needed

## Testing Guidelines

### Writing Tests

- Use Vitest for all tests
- Place tests in `test/` directory
- Name test files with `.test.ts` suffix
- Test both success and error cases

Example test:

```typescript
import { describe, expect, it } from 'vitest';
import { myFunction } from '../src/index.js';

describe('myFunction', () => {
  it('should handle normal case', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('should handle edge case', () => {
    expect(myFunction('')).toBe('');
  });

  it('should throw on invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

### Test Coverage

- Aim for high coverage of business logic
- Don't obsess over 100% coverage
- Focus on meaningful tests over coverage metrics

## Documentation

### When to Update Documentation

Update documentation when you:
- Add new features
- Change APIs
- Fix bugs that affect usage
- Improve existing functionality

### Documentation Files

- `README.md` - Project overview and quick start
- `docs/design.md` - Architecture and design decisions
- `docs/development.md` - Development guide
- `docs/api.md` - API documentation
- `AGENTS.md` - Guidelines for AI agents
- `CHANGELOG.md` - Version history
- `CONTRIBUTING.md` - This file

### Writing Good Documentation

- Use clear, concise language
- Include code examples
- Keep examples up to date
- Link to related documentation
- Use proper Markdown formatting

## Commit Guidelines

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Build/tooling changes

**Examples:**
```
feat(cli): add new command for data export
fix(core): resolve timezone handling bug
docs: update API documentation with examples
test(web): add tests for authentication flow
```

### Commit Best Practices

- Keep commits atomic (one logical change per commit)
- Write clear, descriptive messages
- Reference issues when applicable
- Don't commit broken code
- Don't commit generated files (dist/, node_modules/)

## Pull Request Process

### Before Submitting

1. Ensure all tests pass: `pnpm test`
2. Ensure code is linted: `pnpm lint`
3. Update documentation if needed
4. Add/update tests for your changes
5. Rebase on latest main if needed

### PR Description

Include:
- What changes were made
- Why the changes were necessary
- How to test the changes
- Any breaking changes
- Related issues

### Review Process

1. Automated CI checks run
2. Maintainers review code
3. Address feedback
4. Get approval
5. Squash and merge

## Release Process

### Versioning

Follow [Semantic Versioning](https://semver.org/):
- MAJOR: Breaking changes
- MINOR: New features (backwards compatible)
- PATCH: Bug fixes

### Creating a Release

1. Update version in `packages/cli/package.json`
2. Update `CHANGELOG.md`
3. Commit changes: `git commit -m "chore: bump version to 1.2.3"`
4. Create tag: `git tag v1.2.3`
5. Push: `git push && git push --tags`
6. GitHub Actions automatically publishes

## Getting Help

- Check existing documentation
- Review similar code in the codebase
- Open an issue for questions
- Ask in discussions
- Review closed issues/PRs

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what's best for the project
- Show empathy towards others
- Follow project guidelines

Thank you for contributing! 🎉
