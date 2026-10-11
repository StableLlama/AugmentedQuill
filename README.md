# AugmentedQuill

[![Build Status](https://img.shields.io/github/actions/workflow/status/StableLlamaAI/AugmentedQuill/code-quality.yml?branch=develop)](https://github.com/StableLlamaAI/AugmentedQuill/actions)
[![License: GPLv3](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)

![AugmentedQuill logo](static/images/logo_2048.png)

**Local-first AI writing assistant with story structure + chatbot + image prompt support.**

- You are the author in the driver seat: your story is your story, and the AI is a creative partner (from brainstorm buddy to ghostwriter-style assistant) that supports your voice and choices.
- Join the community: [r/AugmentedQuill](https://www.reddit.com/r/AugmentedQuill/)

![Main screen of AugmentedQuill](docs/user_manual/screenshots/main.png)

---

## What is AugmentedQuill?

AugmentedQuill is a project-based writing environment for short stories, novels, and series. It combines a familiar three-panel writing interface (story structure + editor + AI chat) with AI tools that understand your story's context:

- **AI writing tools** — extend, rewrite, and suggest prose in the editor using your story's own context (chapters, summary, style tags).
- **AI chat assistant** — brainstorm, delegate prose, and manage your project (chapters, Sourcebook, metadata) through conversation.
- **Sourcebook** — keep characters, places, lore, and rules consistent; the AI uses the same canon on every call.
- **Story structure** — chapters, books, scenes, conflicts, and summaries keep long-form work organized.
- **Image prompts** — manage reference art and generate optimized image prompts from your project's style.

### Free, private, local-first

- **Open source & free** — AugmentedQuill is open source (GPLv3). There is no subscription, account, or usage fee.
- **Runs on your machine** — the app never runs in the cloud. Your projects, chapters, and Sourcebook stay in local folders on your own machine.
- **AI is your choice** — connect a local LLM (`llama.cpp`/Ollama) for zero running cost and full privacy, or optionally connect a cloud API (OpenAI, Claude, Google, DeepSeek, OpenRouter) if you prefer — a cloud provider is never required.

## Quick start

1. **Install** — download the desktop app from the [Releases](https://github.com/StableLlamaAI/AugmentedQuill/releases) page, use [Docker](INSTALL.md#2-docker-home-server-or-nas), or [build from source](DEVELOPMENT.md). The full [Installation Guide](INSTALL.md) walks through every method.
2. **Connect an LLM provider** — AugmentedQuill does not bundle an AI server. Point it at a local `llama.cpp`/Ollama endpoint (free and private) or, if you choose, a cloud OpenAI-compatible API (OpenAI, Claude, Google Gemini, DeepSeek, OpenRouter) under **Settings → Machine Settings**.
3. **Start writing** — create a project (or let the Writing Partner do it for you) and talk to the AI chat.

## Documentation

- **User manual** — the complete guide is in [`docs/user_manual/`](docs/user_manual/index.md). Start with [Getting Started](docs/user_manual/01_getting_started.md) and the [Tutorial: Writing Your First Story](docs/user_manual/06_tutorial_first_story.md).
- **Installation Guide** — [`INSTALL.md`](INSTALL.md)
- **Developer Guide** — [`DEVELOPMENT.md`](DEVELOPMENT.md) (setup, commands, architecture entry points)
- **Technical deep dives** — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ORGANIZATION.md`](docs/ORGANIZATION.md)
- **Contributing** — [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Security & deployment

AugmentedQuill is a local-first, single-user application with no built-in authentication. Do not expose it to the public internet without adding your own reverse proxy and access control. See the [Getting Started](docs/user_manual/01_getting_started.md) and [Troubleshooting & FAQ](docs/user_manual/13_troubleshooting.md) chapters for details.

## Community

- [r/AugmentedQuill](https://www.reddit.com/r/AugmentedQuill/) — join the community
- Report bugs and request features via [GitHub Issues](https://github.com/StableLlamaAI/AugmentedQuill/issues)

## License

AugmentedQuill is licensed under the [GNU General Public License v3.0](LICENSE).
