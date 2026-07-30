# Documentation

This directory contains project documentation and guides.

## Contents

- **design.md** - Architecture and technical design decisions
- **development.md** - Development guide and setup instructions
- **api.md** - API documentation for public interfaces
- **contributing.md** - Guidelines for contributors

## Template Usage

This is a template repository. To use it:

1. Click "Use this template" on GitHub or clone the repository
2. Update package names in all `package.json` files
3. Update repository URLs in `package.json` files
4. Update the README.md with your project details
5. Configure GitHub secrets for CI/CD:
   - `NPM_TOKEN` - For publishing to npm
   - `GITHUB_TOKEN` - Automatically provided by GitHub

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Start development
cd packages/cli && pnpm build
cd packages/web && pnpm build
cd packages/mcp && pnpm build
```

## Package Structure

Each package should follow this structure:

```
packages/[name]/
├── src/
│   ├── index.ts       # Main entry point
│   └── ...            # Source files
├── test/
│   └── *.test.ts      # Test files
├── package.json       # Package configuration
├── tsconfig.json      # TypeScript config
└── README.md          # Package documentation
```

## Adding New Packages

1. Create directory in `packages/`
2. Add `package.json` with workspace dependencies
3. Add `tsconfig.json` extending base config
4. Add to workspace in root `pnpm-workspace.yaml`
5. Implement source and tests
6. Document in package README

## Documentation Standards

- Use Markdown for all documentation
- Keep documentation up to date with code changes
- Include code examples where helpful
- Link between related documents
- Use clear, concise language
