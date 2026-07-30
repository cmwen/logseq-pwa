# AI Agent Guidelines

This document provides guidelines for AI agents working with this codebase.

## Project Structure

This is a TypeScript monorepo using pnpm workspaces with the following packages:

- `packages/core` - Core business logic and shared utilities
- `packages/cli` - Command-line interface
- `packages/web` - Web application with REST API
- `packages/mcp` - Model Context Protocol server for AI agent integration

## Development Workflow

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format
```

### Making Changes

1. **Understand the context**: Review related code and tests before making changes
2. **Make minimal changes**: Only modify what's necessary to address the issue
3. **Follow patterns**: Maintain consistency with existing code style and patterns
4. **Write tests**: Add or update tests for your changes
5. **Build and test**: Run `pnpm build && pnpm test` to verify your changes
6. **Lint and format**: Run `pnpm lint` to ensure code quality

### Code Standards

- **TypeScript**: Use strict mode, avoid `any` when possible
- **Formatting**: Biome handles formatting automatically
- **Imports**: Use ES modules (`import/export`)
- **Naming**: Use camelCase for variables/functions, PascalCase for classes/types
- **Error handling**: Use try/catch with meaningful error messages
- **Documentation**: Add JSDoc comments for public APIs

## Package Dependencies

- **Core**: Should have minimal dependencies and be framework-agnostic
- **CLI**: Can depend on Core and command-line libraries (e.g., commander)
- **Web**: Can depend on Core and web frameworks (e.g., Express, React/Preact)
- **MCP**: Can depend on Core and MCP SDK

## Testing

- Use Vitest for unit tests
- Test files go in `test/` directory within each package
- Run tests with `pnpm test` (all packages) or `cd packages/[name] && pnpm test` (single package)
- Aim for good coverage of business logic and edge cases

## Building and Bundling

- TypeScript compilation: `pnpm build` (uses `tsc -b`)
- CLI bundling: Uses Rolldown for single-file executable
- Web bundling: Uses Vite for optimized production builds

## CI/CD

- **CI Pipeline**: Runs on all PRs and pushes to main
  - Lints, formats, builds, and tests all packages
  - Tests on Node.js 20.x and 22.x
  
- **Release Pipeline**: Triggers on version tags (`v*`)
  - Runs full test suite
  - Publishes CLI package to npm
  - Creates GitHub release

## Publishing

The release process uses semantic versioning:

1. Update version in `packages/cli/package.json`
2. Update CHANGELOG.md
3. Commit changes
4. Create and push tag: `git tag v1.0.0 && git push origin v1.0.0`
5. CI automatically publishes to npm and creates GitHub release

## Common Tasks

### Adding a new feature
1. Implement in appropriate package (usually Core)
2. Add tests
3. Expose through CLI/Web/MCP as needed
4. Update documentation

### Fixing a bug
1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify test passes
4. Check for similar issues elsewhere

### Updating dependencies
1. Use `pnpm update` to update within semver ranges
2. Test thoroughly after updates
3. Check for breaking changes in CHANGELOG of updated packages

## MCP Integration

The MCP package allows AI agents to interact with the application programmatically:

- Exposes tools/prompts via Model Context Protocol
- Runs as stdio server for local AI clients
- Shares configuration with CLI and Web packages

## Best Practices

- **Keep it simple**: Prefer simple, readable code over clever solutions
- **Performance**: Focus on correctness first, optimize only when needed
- **Security**: Validate inputs, sanitize outputs, avoid hardcoded secrets
- **Maintainability**: Write code that's easy to understand and modify
- **Documentation**: Keep README and docs up to date with changes

## Getting Help

- Check existing tests for usage examples
- Review similar code in the codebase
- Consult package documentation in `docs/` directory
- Reference TypeScript and library documentation

## Notes for AI Agents

- Always run builds and tests before finalizing changes
- Check git status to ensure you're only committing relevant files
- Follow the existing code style and patterns
- Ask for clarification if requirements are unclear
- Use the MCP package to integrate with AI workflows when appropriate
