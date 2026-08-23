#!/usr/bin/env bash
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# Purpose: bootstraps the AugmentedQuill dev container on creation/rebuild.
# Creates the repo-root Python venv, installs backend + frontend dependencies,
# and provisions Playwright Chromium for the E2E and docs screenshot suites.
# The venv/ and node_modules/ targets are named volumes managed by the
# devcontainer, so this only fully installs once and is fast on later rebuilds.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> [1/6] Fixing ownership of named-volume mount points"
# Fresh named volumes and the parent ~/.cache dir are root-owned; give the
# vscode user write access. ~/.cache must be writable so pre-commit (and other
# tools) can create their caches; the Playwright volume is chowned recursively.
sudo chown "$(id -u):$(id -g)" "$HOME/.cache" 2>/dev/null || true
for dir in \
  "$REPO_ROOT/venv" \
  "$REPO_ROOT/src/frontend/node_modules" \
  "$HOME/.cache/ms-playwright"; do
  sudo chown -R "$(id -u):$(id -g)" "$dir" 2>/dev/null || true
done

echo "==> [2/6] Creating Python virtual environment (venv/)"
if [[ ! -x "$REPO_ROOT/venv/bin/python" ]]; then
  python3 -m venv "$REPO_ROOT/venv"
fi
"$REPO_ROOT/venv/bin/python" -m pip install --upgrade pip

echo "==> [3/6] Installing backend + dev dependencies (editable)"
"$REPO_ROOT/venv/bin/pip" install -e ".[dev]"

echo "==> [4/6] Installing frontend dependencies"
cd "$REPO_ROOT/src/frontend"
npm install --legacy-peer-deps

echo "==> [5/6] Installing Playwright Chromium (browser + system deps)"
npx playwright install --with-deps chromium

echo "==> [6/6] Configuring tooling (PATH + pre-commit hooks)"
# Put the repo venv's tools on PATH so ruff/black/pytest/pre-commit work from a
# fresh shell without manually activating the venv (the container disables the
# Python auto-activation in the terminal).
if ! grep -q "AUGMENTEDQUILL_VENV_PATH" "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ""
    echo "# AugmentedQuill: expose repo venv tools (ruff, black, pytest, pre-commit)"
    echo "export PATH=\"$REPO_ROOT/venv/bin:\$PATH\"  # AUGMENTEDQUILL_VENV_PATH"
  } >> "$HOME/.bashrc"
fi

# Regenerate the pre-commit hook so it points at this container's venv, not a
# stale path baked in from another machine (which caused 'pre-commit not found').
"$REPO_ROOT/venv/bin/pre-commit" install

echo ""
echo "==> Dev container ready."
echo "    - Backend:  augmentedquill --reload --host 127.0.0.1 --port 28000"
echo "    - Frontend: cd src/frontend && npm run dev  (http://127.0.0.1:5173)"
echo "    - Tests:    venv/bin/pytest | cd src/frontend && npm run test"
