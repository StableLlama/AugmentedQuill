# Installation Guide

AugmentedQuill offers multiple ways to install and run the application, depending on your technical background and how you prefer to use it.

## 1. Portable Executable (Easiest for Artists & Authors)

If you just want to double-click an app and start writing in your own web browser without installing any dependencies, this is the option for you.

**How it works:** We bundle the entire Python backend and the pre-built frontend into a single executable file using PyInstaller. When you run it, it starts a local server and automatically opens AugmentedQuill in your default web browser.

**Installation:**

1. Go to the [Releases](../../releases) page on GitHub.
2. Download the executable for your operating system (`.exe` for Windows, `.app` or binary for macOS, binary for Linux).
3. Place the file in a folder where you want your stories to be saved (it will create `data/` and `resources/` folders next to it).
4. Double-click the executable. Your browser will open automatically!

---

## 2. Standalone Desktop App (Electron)

> **Note:** The Electron desktop wrapper is currently **experimental / work in progress**. No official installer is published yet. See `docs/ARCHITECTURE.md` § 8 for development notes.

If you prefer a complete, isolated desktop application experience rather than using your web browser, you can use the Electron version.

**How it works:** This bundles the PyInstaller backend with an Electron frontend, giving you a native-feeling windowed application.

**Installation (once an official release is available):**

1. Go to the [Releases](../../releases) page on GitHub.
2. Download the installer for your operating system (e.g., `AugmentedQuill-Setup.exe` for Windows, `.dmg` for macOS, `.AppImage` for Linux).
3. Run the installer and launch AugmentedQuill from your applications menu.

---

## 3. Docker (Best for Self-Hosters & Home Servers)

If you run a home server, NAS, or just prefer keeping your applications containerized, you can use Docker. This avoids installing Python or Node.js on your host machine.

**Prerequisites:**

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed.

**Installation:**

1. Download the `docker-compose.yml` file from this repository (or create your own using the example below).
2. Open a terminal in the directory containing the file and run:

   ```bash
   docker compose up -d
   ```

   This uses image `ghcr.io/stablellamaai/augmentedquill:latest` and maps host port `8000` to container port `8000`.

   If you don’t want to use Docker Compose, you can run directly with Docker:

   ```bash
   docker run -d --name augmentedquill \
     -p 8000:8000 \
     -v "$PWD/data:/app/data" \
     -v "$PWD/resources/config:/app/resources/config" \
     ghcr.io/stablellamaai/augmentedquill:latest
   ```

3. Open your browser and point to `http://localhost:8000/` (or `http://<server-ip>:8000/` when running on a remote machine).

_Note: Your stories and configuration will be saved in the `./data` and `./resources/config` directories next to your `docker-compose.yml` file._

---

## 4. Developer Setup (From Source)

If you want to modify the code, contribute to the project, or just prefer running things from source, follow these steps.

**Prerequisites:**

- Python 3.12+
- Node.js 24+
- Git

**Installation:**

1. Clone the repository:

   ```bash
   git clone https://github.com/StableLlamaAI/AugmentedQuill.git
   cd AugmentedQuill
   ```

2. Set up the Python backend:

   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   pip install -e ".[dev]"
   ```

3. Build the frontend:

   ```bash
   cd src/frontend
   npm install
   npm run build
   cd ../..
   ```

4. Run the application:
   ```bash
   augmentedquill --host 127.0.0.1 --port 8000
   ```
   Then open `http://127.0.0.1:8000` in your browser.

For hot-reloading during development, see the Development Workflow section in the [Developer Guide](DEVELOPMENT.md).

### Branching notes for contributors

When contributing, branch from `develop` and open pull requests against `develop` (unless the change is an urgent fix to `main`).

- Feature branches: `feature/<short-desc>`
- Release branches: `release/vX.Y` (short-lived)
- Hotfix branches: `hotfix/vX.Y.Z` (branch from `main`)

The `main` branch always reflects the last release; `develop` is the integration branch used for ongoing development.
