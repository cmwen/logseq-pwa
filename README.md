# min-node-app-template

> A comprehensive Node.js application template with CLI, Web, and MCP (Model Context Protocol) support

[![CI](https://github.com/cmwen/min-node-app-template/actions/workflows/ci.yml/badge.svg)](https://github.com/cmwen/min-node-app-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This template provides a modern, production-ready foundation for building Node.js applications with multiple interfaces (CLI, Web, and AI agent integration).

## ✨ Features

- 🎯 **Unified CLI** - Single executable with three modes: CLI, Web, and MCP
- 🏗️ **Monorepo structure** with pnpm workspaces
- 📦 **TypeScript** with strict mode
- 🎨 **Biome** for lightning-fast linting and formatting
- 📦 **Rolldown** for optimized CLI bundling
- 🧪 **Vitest** for unit testing
- 🤖 **MCP support** for AI agent integration
- 🔄 **CI/CD** with GitHub Actions
- 🐳 **Devcontainer** ready
- 🔒 **Dependabot** configured

## 📦 Package Structure

This monorepo contains:

- **`@template/core`** - Core business logic and shared utilities
- **`@template/cli`** - Unified CLI with three modes:
  - **CLI mode** - Command-line interface with Commander.js
  - **Web mode** - Express REST API server
  - **MCP mode** - Model Context Protocol server for AI agents
- **`@template/web`** - Web UI components (Preact, used by CLI web mode)
- **`@template/mcp`** - MCP server implementation (used by CLI mcp mode)

## 🚀 Quick Start

### Using This Template

1. Click "Use this template" on GitHub
2. Clone your new repository
3. Update package names in all `package.json` files
4. Update repository URLs
5. Update README with your project details

### Development Setup

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

### Running the Unified CLI

The CLI supports three modes:

#### CLI Mode (Default Commands)
```bash
cd packages/cli
pnpm build

# Basic commands
node dist/index.js greet "World"
node dist/index.js info
node dist/index.js --help
```

#### Web Mode
```bash
# Start web server with REST API
node dist/index.js web --port 3000

# Or use bundled version
node dist/bundled.js web
```

#### MCP Mode
```bash
# Start MCP server for AI agent integration
node dist/index.js mcp

# Or use bundled version
node dist/bundled.js mcp
```

### Building the Bundle

```bash
cd packages/cli
pnpm build:bundle

# Creates a single bundled executable at dist/bundled.js
# This includes all three modes in one file
```

## 🏗️ Project Structure

```
min-node-app-template/
├── .devcontainer/          # Dev container configuration
├── .github/
│   ├── workflows/          # CI/CD pipelines
│   │   ├── ci.yml         # Continuous Integration
│   │   └── release.yml    # Release pipeline
│   └── dependabot.yml     # Dependency updates
├── docs/                   # Documentation
│   ├── README.md          # Documentation index
│   ├── design.md          # Architecture & design
│   └── development.md     # Development guide
├── packages/
│   ├── core/              # Core package
│   │   ├── src/
│   │   ├── test/
│   │   └── package.json
│   ├── cli/               # CLI package
│   │   ├── src/
│   │   ├── test/
│   │   ├── scripts/       # Build scripts
│   │   └── package.json
│   ├── web/               # Web package
│   │   ├── src/
│   │   │   ├── server.ts  # Express server
│   │   │   └── client/    # Preact UI
│   │   ├── test/
│   │   └── package.json
│   └── mcp/               # MCP package
│       ├── src/
│       ├── test/
│       └── package.json
├── .gitignore
├── .biomeignore
├── biome.json             # Linting & formatting
├── package.json           # Root package
├── pnpm-workspace.yaml    # Workspace config
├── tsconfig.base.json     # Base TypeScript config
├── AGENTS.md              # AI agent guidelines
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## 🛠️ Tech Stack

- **Language**: TypeScript 5.x
- **Package Manager**: pnpm 10.x
- **Build Tool**: TypeScript Compiler (tsc)
- **Bundlers**: 
  - Rolldown (CLI single-file bundle)
  - Vite (Web frontend)
- **Testing**: Vitest
- **Linting/Formatting**: Biome
- **CLI Framework**: Commander.js
- **Web Framework**: Express + Preact
- **AI Integration**: Model Context Protocol SDK

## 📚 Documentation

- [Architecture & Design](docs/design.md)
- [Development Guide](docs/development.md)
- [AI Agent Guidelines](AGENTS.md)
- [Contributing](CONTRIBUTING.md)

## 🔧 Configuration

### GitHub Secrets

For CI/CD to work properly, configure these secrets:

- `NPM_TOKEN` - For publishing packages to npm
- `GITHUB_TOKEN` - Automatically provided by GitHub

### Customization

1. **Package Names**: Update `name` in all `package.json` files
2. **Repository URLs**: Update `repository.url` in all `package.json` files
3. **License**: Update LICENSE file if needed
4. **Styling**: Customize Biome rules in `biome.json`
5. **Build**: Adjust TypeScript config in `tsconfig.base.json`

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run tests with coverage
pnpm test -- --coverage

# Test specific package
cd packages/core
pnpm test
```

## 📦 Building

```bash
# Build all packages
pnpm build

# Build CLI bundle
cd packages/cli
pnpm build:bundle

# Build web for production
cd packages/web
pnpm build
```

## 🚀 Publishing

The template includes automated publishing via GitHub Actions:

1. Update version in `packages/cli/package.json`
2. Update `CHANGELOG.md`
3. Commit changes
4. Create and push tag: `git tag v1.0.0 && git push origin v1.0.0`
5. GitHub Actions will automatically publish to npm

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📝 License

MIT License - see [LICENSE](LICENSE) for details

## 🔗 Links

- [GitHub Repository](https://github.com/cmwen/min-node-app-template)
- [Issue Tracker](https://github.com/cmwen/min-node-app-template/issues)

## 💡 Template Philosophy

This template is designed for:
- Developers who want a solid foundation for Node.js projects
- Projects that need multiple interfaces (CLI, Web, AI)
- Teams that value type safety and developer experience
- Applications that benefit from monorepo structure
- Projects requiring AI agent integration via MCP

---

**Built with ❤️ using modern TypeScript tooling**