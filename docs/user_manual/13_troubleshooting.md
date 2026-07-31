# Troubleshooting & FAQ

This page collects common issues, requested limitations, and recommended mitigations for AugmentedQuill.

## 1. General usage and local-only assumptions

AugmentedQuill is designed for local desktop or local server usage. It has no built-in user authentication and no access control for projects. Keep it behind a secure private network (e.g., local machine, private LAN, VPN) in production-like environments.

- Do not expose the app to the public internet without adding your own reverse proxy with authentication (nginx + OAuth/OpenID/HTTP basic, etc.).
- Project data is stored locally:
  - `data/projects/` for story projects
  - `data/config/` for local config
  - `data/logs/` for runtime logs
- No “sync with external editor” integration exists yet. If you want versioned backups, use your own source control (Git) on `data/projects` or manual export via the UI.
- No official accessibility compliance is implemented (keyboard shortcuts, screen-reader semantics, ARIA tagging). Use a desktop environment and browser with your own accessibility tools where possible.

## 2. Common user-reported issues

### 2.1 “Models don’t load” / “no models found”

- Ensure `Machine Settings` has at least one provider with valid base URL and API key.
- Test the provider in Settings. Inspect connection status and model status.
- CORS issues are common for browser clients; check your target API’s CORS headers. The app can proxy `/api/v1/openai/models`, but the endpoint itself must support browser requests or local proxy configuration.

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

## 3. Known limitations (2026)

- No per-user or per-project authentication.
- No multi-user collaboration natively; multiple people can edit only through shared filesystem state (not simultaneously safe).
- No scheduled auto-save backup outside the local `data` directory.
- No keyboard shortcut documentation yet (some feature keys may exist in the frontend but are not guaranteed or documented).

## 4. Troubleshooting checklist

1. Restart the app (stop and rerun `augmentedquill` or the Electron front-end).
2. Confirm the target provider is reachable and model has low-latency.
3. Check browser developer tools for network errors (CORS, 502, 503).
4. Review `data/logs/llm_raw.log` for request/response details.
5. Use “Clear Debug Logs” in UI before reproducing the issue.

## 5. FAQ

Q: Is the application intended for public internet hosting?
A: No, not without additional network security. The default design is local-first with no built-in auth.

Q: Can I use keyboard shortcuts to write faster?
A: Not yet; this is planned in future UI work. The manual currently specifies some editor-specific shortcuts in limited contexts (suggestions keys).

Q: Can I sync projects to another machine automatically?
A: Not built-in. Use Git or external sync tools against `data/projects`, or use the UI Export ZIP path.

Q: How do I handle large projects with many images and sourcebook entries?
A: Keep `data/projects` on an SSD for best performance. Use “Auto” Sourcebook selection carefully for big wikis to avoid extra context in each request.
