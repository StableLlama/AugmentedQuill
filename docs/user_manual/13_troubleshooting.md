# Troubleshooting & FAQ

This page collects common issues, requested limitations, and recommended mitigations for AugmentedQuill.

## 1. General usage and local-only assumptions

AugmentedQuill is designed for local desktop or local server usage. It has no built-in user authentication and no access control for projects. Keep it behind a secure private network (e.g., local machine, private LAN, VPN) in production-like environments.

- Do not expose the app to the public internet without adding your own reverse proxy with authentication (nginx + OAuth/OpenID/HTTP basic, etc.).
- Project data is stored locally:
  - `data/projects/` for story projects
  - `data/config/` for machine settings and the project registry
  - `data/logs/` for runtime logs
- The path is install-dependent: the desktop app uses its folder under the operating system's application-data location; Docker stores data in the `data/` folder beside the Compose file; source installs use the repository's `data/` folder by default. In Docker, the host `data/` folder is mounted at `/app/data`; do not delete it when replacing the container.
- For a complete backup, close the desktop app and copy its AugmentedQuill application-data folder, or stop a Docker/source server and copy its entire `data/` folder. A project ZIP export is useful for moving or backing up one project. No “sync with external editor” integration exists yet.
- `resources/config/` contains application resources such as presets and instruction text. It is not the normal location for user settings or project files.
- Accessibility support is implemented for core flows (screen-reader semantics, visible keyboard focus, keyboard shortcuts, focus-trapped dialogs, reduced-motion support) and is checked automatically as part of development, but the app is not WCAG-certified. See [Keyboard Shortcuts & Accessibility](14_keyboard_shortcuts_and_accessibility.md) for what is covered and the known gaps.

## 2. Common user-reported issues

### 2.1 “Models don’t load” / “no models found”

- Ensure `Machine Settings` has at least one provider with valid base URL and API key.
- Test the provider in Settings. Inspect connection status and model status.
- Some providers refuse requests that appear to come from a browser. AugmentedQuill routes cloud-provider requests through its own local server to avoid this; if a provider still refuses connections, check the model-loading guidance above.

### 2.2 “LLM request fails, 401/403”

- Confirm that the API key is correct and not expired/revoked.
- For OpenAI compatibility, ensure the key and base URL match the provider (e.g., `https://api.openai.com/v1`).
- If using local model endpoints, ensure local server is running and key requirements are satisfied.

### 2.3 “Project won’t open / corrupted file”

- Verify `data/projects/<project>/story.json` and `data/projects/<project>/*.md` are valid JSON/UTF-8.
- Use the checkpoint system (`Checkpoints` menu) to restore earlier state.
- If you cannot recover, export project as zip if possible before manual repair.

### 2.4 “Sourcebook relevance auto-selection is wrong”

- Auto mode depends on AI relevance prediction and might miss entries in complex contexts.
- Use manual include/exclude toggles in Sourcebook list and disable Auto if needed.

### 2.5 Docker / container networking (LLM providers unreachable)

If you run AugmentedQuill in Docker (or a dev container) and _“Models don’t load”_ / every AI request fails, the cause is usually **container networking** rather than a bad API key. The right fix depends on where your provider runs:

**1. Cloud providers (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, …)**

Containers get outbound internet access **by default** through the host's NAT, so no special settings are needed. If cloud calls fail, check:

- The Docker host itself can reach the internet (DNS + egress).
- No host firewall blocks traffic leaving the Docker bridge (e.g. `ufw`/`iptables`, a VPN, or a corporate egress proxy).
- If the host needs an HTTP(S) proxy, pass it into the container with `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment variables (see the Compose example below). AugmentedQuill uses these settings when calling cloud providers.

**2. A provider running on the same Docker _host_** (e.g. Ollama / llama.cpp on the host machine)

Inside a container, `localhost` / `127.0.0.1` refers to the **container itself**, not the Docker host — so `http://localhost:11434/v1` fails with _connection refused_ even though the server is running. Use the special hostname `host.docker.internal` instead, which requires the container to be started with `extra_hosts: ["host.docker.internal:host-gateway"]` (Docker ≥ 20.10; automatic on Docker Desktop for macOS/Windows). `host.docker.internal` is treated as a trusted local endpoint by AugmentedQuill.

**3. A provider running in _another container_ on the same Docker server**

Reach it by its service/container name on a shared user-defined network (e.g. an `ollama` service at `http://ollama:11434/v1`), or via the Docker bridge gateway IP (commonly `http://172.17.0.1:11434/v1`).

**Compose example** — allow the container to reach a provider on the host and let cloud calls use the host's proxy:

```yaml
services:
  augmentedquill:
    # ...existing augmentedquill service config...
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      - OPENAI_BASE_URL=http://host.docker.internal:11434/v1 # optional: host-local provider
      - HTTP_PROXY=${HTTP_PROXY:-}
      - HTTPS_PROXY=${HTTPS_PROXY:-}
      - NO_PROXY=${NO_PROXY:-}
```

**Base URL trust.** AugmentedQuill only sends requests to addresses it trusts: local addresses (`localhost`, `127.0.0.1`, `0.0.0.0`, `host.docker.internal`) and any address you **save in Machine Settings** (or set via the `OPENAI_BASE_URL` setting when you run a server yourself). If you type an ad-hoc address directly into a request (e.g. a bridge IP such as `172.17.0.1`), it is rejected. Fix: save the provider in **Settings → Machine Settings**, or set `OPENAI_BASE_URL`.

**How to diagnose**

1. Open the **Debug Logs** window (header button → _LLM Communication Logs_). Failed requests now show a categorized network error (e.g. _DNS lookup failed_, _Connection refused_, _timed out_) with an actionable hint.
2. Use the **Network diagnostics** panel in the Debug Logs window to test DNS, TCP and HTTPS from _inside the container_ — this separates “the container can't reach the provider” from “the provider rejected the request”.
3. From the host shell, test outbound connectivity directly:

   ```bash
   docker exec -it augmentedquill python -c \
     "import urllib.request; print(urllib.request.urlopen('https://api.openai.com/v1', timeout=10).status)"
   ```

4. For full request/response details, enable the raw request log (see the [Developer Guide](../../DEVELOPMENT.md#debug-diagnostics)).

### 2.6 “Desktop app can’t reach a local model” (system proxy)

The desktop app's backend uses the same HTTP client as the server version. A common cause of “local model unreachable” is an **HTTP(S) proxy**:

- The HTTP client honors `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`
  environment variables — and on Windows it also picks up the system proxy
  from the registry (Internet Options).
- By default that proxy would be used for _every_ request, including ones to
  `localhost` / `127.0.0.1`. If the proxy can’t reach your local model (or
  refuses to proxy local addresses), the request fails even though the model
  is running.
- Browsers and `curl` bypass `localhost` by default. AugmentedQuill now does
  too: **loopback addresses are never routed through a proxy** (`localhost`,
  `127.0.0.1`, `::1`, `0.0.0.0`, and the Docker host aliases). Cloud providers
  still go through the proxy when one is configured.

If you still can’t reach a local model from a desktop build:

1. Confirm the model server is listening — from a terminal:
   `curl http://127.0.0.1:8080/v1/models`.
2. Prefer `http://127.0.0.1:<port>/v1` over `http://localhost:<port>/v1`: on
   some Windows setups `localhost` resolves to IPv6 `::1` while the model
   server listens only on IPv4 `127.0.0.1`.
3. Save the provider in **Settings → Machine Settings**, then use the **Debug
   Logs** window → **Network diagnostics** panel to see which step fails (DNS,
   TCP, HTTP).
4. Check the raw request/response log for details (see the [Developer Guide](../../DEVELOPMENT.md#debug-diagnostics)).

## 3. Known limitations (2026)

- No per-user or per-project authentication.
- No multi-user collaboration natively; multiple people can edit only through shared filesystem state (not simultaneously safe).
- No scheduled auto-save backup outside the local `data` directory.
- Not every action has a keyboard shortcut; the supported set (undo/redo, search, suggestions, annotations) is documented in [Keyboard Shortcuts & Accessibility](14_keyboard_shortcuts_and_accessibility.md).

## 4. Troubleshooting checklist

1. Restart the app (close and reopen it, or restart the server).
2. Confirm the target provider is reachable and model has low-latency.
3. Check the browser's developer tools for network errors (e.g. connection failures, HTTP 502/503).
4. Review the request/response log for details (see the [Developer Guide](../../DEVELOPMENT.md#debug-diagnostics)).
5. Use “Clear Debug Logs” in UI before reproducing the issue.

## 5. FAQ

Q: Is the application intended for public internet hosting?
A: No, not without additional network security. The default design is local-first with no built-in auth.

Q: Can I use keyboard shortcuts to write faster?
A: Yes, for the most common actions: **Ctrl/Cmd+Z** (undo), **Ctrl/Cmd+Y** (redo), **Ctrl/Cmd+F** (search & replace), **Ctrl+Enter/Cmd+Enter** (AI suggestions), and **Ctrl+Shift+A/Cmd+Shift+A** (annotations). See the full list in [Keyboard Shortcuts & Accessibility](14_keyboard_shortcuts_and_accessibility.md). Not every action has a shortcut yet, so some flows still require the mouse.

Q: Can I sync projects to another machine automatically?
A: Not built-in. Use Git or external sync tools against `data/projects`, or use the UI Export ZIP path.

Q: How do I handle large projects with many images and sourcebook entries?
A: Keep `data/projects` on an SSD for best performance. Use “Auto” Sourcebook selection carefully for big wikis to avoid extra context in each request.

---

Next up: See [Keyboard Shortcuts & Accessibility](14_keyboard_shortcuts_and_accessibility.md) for the supported shortcuts and accessibility features.
