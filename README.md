# @snapdeploy/mcp

Deploy and manage [SnapDeploy](https://snapdeploy.dev) containers from your AI assistant —
Claude Code, Claude Desktop, Cursor, Windsurf, Codex CLI, Gemini CLI, or any client that
speaks the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio.

Say *"deploy this repo to SnapDeploy"* and get a live URL back. Builds, logs, environment
variables, managed databases and custom domains — without leaving the chat.

## Setup

1. Sign in at [snapdeploy.dev](https://snapdeploy.dev), open **API Keys** and create a
   token with the `deploy` scope (the page generates the snippets below with your token
   already filled in).
2. Add the server to your client:

**Claude Code**

```bash
claude mcp add --scope user snapdeploy -e SNAPDEPLOY_API_KEY=sd_pat_your_token -- npx -y @snapdeploy/mcp
```

**Cursor** (`~/.cursor/mcp.json`), **Windsurf** (`~/.codeium/windsurf/mcp_config.json`),
**Gemini CLI** (`~/.gemini/settings.json`), Claude Desktop and other JSON-configured clients:

```json
{
  "mcpServers": {
    "snapdeploy": {
      "command": "npx",
      "args": ["-y", "@snapdeploy/mcp"],
      "env": { "SNAPDEPLOY_API_KEY": "sd_pat_your_token" }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.snapdeploy]
command = "npx"
args = ["-y", "@snapdeploy/mcp"]
env = { SNAPDEPLOY_API_KEY = "sd_pat_your_token" }
```

**Claude Code plugin** (token stored in secure storage instead of a config file):

```
/plugin marketplace add AAR-Labs/snapdeploy-mcp
/plugin install snapdeploy@snapdeploy
```

Restart the session; the `snapdeploy` tools appear. Your repository must be on GitHub and
GitHub must be connected to SnapDeploy once (the connector returns the link if it isn't).

## Tools

| Scope | Tools |
| --- | --- |
| `read` | `list_apps` `get_status` `get_logs` `get_deployments` `check_quota` `list_repos` `detect_env_vars` |
| `deploy` | `deploy` `set_env` `start_container` `stop_container` `wake_container` |
| `manage` | `create_database` `add_domain` `assign_always_on` |

Scopes nest (`read` ⊂ `deploy` ⊂ `manage`); the server enforces them before any tool runs.
There is no delete tool, and the server refuses deletes, subscription cancellations and
password changes for every token — those need a person signed in to the dashboard or the
mobile app.

## Safety model

- **Nothing destructive, ever.** Even an agent that escalates to a raw API call with the
  same token gets `403 INTERACTIVE_SESSION_REQUIRED`.
- **Secrets never reach the model.** Environment-variable values come back as `(set)`
  and credentials are masked — on the server, not just in this connector.
- **Scoped, expiring, revocable tokens** with their own rate limit. Revoke on the API Keys
  page and every request returns 401 from that moment.
- **Retry-safe deploys.** Identical requests inside ten minutes return the original
  deployment instead of starting another build.
- **Plan limits are relayed, not retried.** 402/429 replies carry SnapDeploy's own message
  and upgrade link, and the assistant is told not to retry.

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `SNAPDEPLOY_API_KEY` | yes | Scoped token (`sd_pat_…`) or legacy API key |
| `SNAPDEPLOY_READ_ONLY` | no | `1` exposes only the read tools |
| `SNAPDEPLOY_BASE_URL` | no | Defaults to `https://snapdeploy.dev` |

## Links

- Guides: [Claude Code](https://snapdeploy.dev/deploy-from-claude-code) ·
  [Cursor](https://snapdeploy.dev/deploy-from-cursor) ·
  [Codex / Gemini CLI](https://snapdeploy.dev/deploy-from-codex) ·
  [Lovable exports](https://snapdeploy.dev/deploy-from-lovable)
- Reference: [snapdeploy.dev/docs/mcp](https://snapdeploy.dev/docs/mcp) ·
  [API](https://snapdeploy.dev/api)
- Design write-up: [why an agent that can deploy must not be able to delete](https://snapdeploy.dev/blog/deploy-from-claude-code-cursor-mcp)

MIT © AAR Labs
