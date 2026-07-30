# Design Document

## Overview

This template provides a foundation for building Node.js applications with CLI, Web, and MCP interfaces.

## Architecture

### Monorepo Structure

The project uses pnpm workspaces to manage multiple packages:

- **Core Package**: Contains shared business logic, models, and utilities
- **CLI Package**: Command-line interface built with Commander.js
- **Web Package**: Web application with REST API (Express) and UI (Vite)
- **MCP Package**: Model Context Protocol server for AI agent integration

### Technology Stack

- **Language**: TypeScript with strict mode
- **Package Manager**: pnpm with workspaces
- **Build Tool**: TypeScript compiler (tsc)
- **Bundler**: Rolldown for CLI, Vite for Web
- **Testing**: Vitest
- **Linting/Formatting**: Biome
- **CI/CD**: GitHub Actions

## Design Principles

### 1. Modularity

Each package has a single responsibility:
- Core focuses on business logic
- CLI provides command-line interface
- Web provides HTTP API and UI
- MCP provides AI agent integration

### 2. Type Safety

- Use TypeScript strict mode
- Define interfaces for all public APIs
- Minimize use of `any` type
- Use discriminated unions for variants

### 3. Testability

- Write unit tests for business logic
- Mock external dependencies
- Use dependency injection where appropriate
- Aim for high code coverage

### 4. Performance

- Lazy load modules when possible
- Bundle CLI into single file for fast startup
- Use streaming for large data processing
- Cache expensive computations

### 5. Developer Experience

- Clear error messages
- Comprehensive documentation
- Fast build and test cycles
- Auto-formatting with Biome

## Package Dependencies

```
cli     → core
web     → core
mcp     → core
core    → (external deps only)
```

The core package should:
- Have minimal external dependencies
- Be framework-agnostic
- Export clean, typed APIs
- Handle data persistence and business logic

## Data Flow

### CLI Flow
```
User → CLI → Core → File System/API
```

### Web Flow
```
Browser → HTTP → Express → Core → File System/API
```

### MCP Flow
```
AI Client → stdio → MCP Server → Core → File System/API
```

## Configuration

Configuration is managed through:
- Environment variables (`.env` files)
- Configuration files (`config.json`, `config.js`)
- Command-line arguments
- Sensible defaults

Priority order (highest to lowest):
1. Command-line arguments
2. Environment variables
3. Configuration files
4. Defaults

## Error Handling

- Use custom error classes for domain errors
- Provide helpful error messages
- Log errors with context
- Handle errors at appropriate boundaries
- Don't expose internal details to users

## Security Considerations

- Validate all inputs
- Sanitize outputs
- Use environment variables for secrets
- Don't commit secrets to git
- Keep dependencies updated
- Run security audits regularly

## Build Process

### Development
```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
```

### Production
```bash
pnpm install --frozen-lockfile
pnpm build
# CLI is bundled into single file
# Web is built with Vite optimization
```

## Deployment

### CLI
- Published to npm as single bundled file
- Executable via `npx` or global install

### Web
- Can be deployed to any Node.js hosting
- Serve static files with Express
- Configure environment variables

### MCP
- Runs locally as stdio server
- Used by AI clients (IDEs, tools)

## Future Considerations

- Add support for plugins/extensions
- Consider GraphQL for Web API
- Add real-time updates (WebSockets)
- Implement caching layer
- Add monitoring and observability
- Support multiple storage backends
