# Contributing to AugmentedQuill

Thank you for your interest in contributing to AugmentedQuill! We welcome contributions from the community, whether it's bug fixes, new features, or improvements to documentation.

## How to Contribute

1.  **Search for existing issues**: Before starting work, check if there's already an issue or pull request for what you're planning.
2.  **Open an issue**: If you find a bug or have a feature request, please open an issue first to discuss it.
3.  **Fork the repository**: Create your own fork and work on a feature branch.
4.  **Follow code hygiene**: Ensure your code follows the project's hygiene standards (see `docs/ORGANIZATION.md`).
    ```bash
    python tools/enforce_code_hygiene.py .
    pre-commit run --all-files
    ```
5.  **Run tests**: Make sure all tests pass before submitting.
    ```bash
    pytest
    cd src/frontend && npm run test
    ```
6.  **Submit a Pull Request**: Provide a clear description of your changes.

## Development Setup

See the [README.md](../README.md) for detailed installation and development workflow instructions.

## Coding Standards

- **Backend**: We use `ruff` and `black` for Python linting and formatting.
- **Frontend**: We use `eslint` and `prettier` for TypeScript/React.
- **Copyright**: All new files must include the GNU GPL v3 license header. Use the tools in `tools/` to apply them.
