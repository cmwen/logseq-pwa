# Contributing to min-node-app-template

Thank you for your interest in contributing! This document provides guidelines for contributing to this template.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards others

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/min-node-app-template.git`
3. Create a feature branch: `git checkout -b feature/my-feature`
4. Make your changes
5. Run tests: `pnpm test`
6. Run linter: `pnpm lint`
7. Commit your changes: `git commit -m "feat: add new feature"`
8. Push to your fork: `git push origin feature/my-feature`
9. Open a Pull Request

## Development Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linter
pnpm lint

# Format code
pnpm format
```

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add new CLI command
fix: resolve type error in core package
docs: update README with examples
```

## Pull Request Process

1. Ensure all tests pass
2. Update documentation as needed
3. Add tests for new functionality
4. Follow the existing code style
5. Keep PRs focused and atomic
6. Write clear PR descriptions

## Code Style

- Use TypeScript strict mode
- Follow Biome formatting rules
- Write meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Write tests for new code

## Testing

- Write unit tests for business logic
- Test edge cases and error conditions
- Aim for good test coverage
- Use descriptive test names
- Keep tests simple and focused

## Documentation

- Update README for user-facing changes
- Update docs/ for technical details
- Include code examples where helpful
- Keep CHANGELOG.md up to date

## Questions?

Feel free to open an issue for:
- Bug reports
- Feature requests
- Questions about the template
- Clarifications on documentation

Thank you for contributing! 🎉
