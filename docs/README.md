# Documentation

This directory contains project documentation and guides.

## Contents

- **design.md** - Architecture and technical design decisions
- **development.md** - Development guide and setup instructions
- **api.md** - API documentation for public interfaces
- **PRD.md** - Product requirements and scope
- **ARD.md** - Block-model architecture decision

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Start the browser app
pnpm --filter @loam/web dev
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
