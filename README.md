# @snapdeploy/mcp

Deploy and manage [SnapDeploy](https://snapdeploy.dev) containers from your AI assistant
(Claude Code, Cursor, Codex CLI, Gemini CLI — anything that speaks MCP over stdio).

> **Status: M0 prototype — founder/tester use only.** Points at the dev environment by
> default until the production go-ahead (containment checklist D4).

## Setup

You need your SnapDeploy API key from **snapdeploy.dev → API Keys**.

### Claude Code

```bash
claude mcp add snapdeploy -e SNAPDEPLOY_API_KEY=sk_... -- npx -y @snapdeploy/mcp
```

### Cursor / other MCP clients (JSON config)

```json
{
  "mcpServers": {
    "snapdeploy": {
      "command": "npx",
      "args": ["-y", "@snapdeploy/mcp"],
      "env": { "SNAPDEPLOY_API_KEY": "sk_..." }
    }
  }
}
```

### Local development (this repo)

```bash
npm install && npm run build
SNAPDEPLOY_API_KEY=sk_... SNAPDEPLOY_BASE_URL=https://containers.somdip.dev node dist/index.js
```

## Environment variables

| Var | Meaning |
|---|---|
| `SNAPDEPLOY_API_KEY` | required — your account's API key |
| `SNAPDEPLOY_BASE_URL` | optional — defaults to the dev environment during M0 |
| `SNAPDEPLOY_READ_ONLY` | `1`/`true` exposes only the read tools |

## Tools

Read: `list_apps`, `get_status`, `get_logs`, `get_deployments`, `check_quota`,
`list_repos`, `detect_env_vars`.

Write: `deploy`, `set_env`, `start_container`, `stop_container`, `wake_container`,
`create_database`, `add_domain`, `assign_always_on`.

## Safety, by design

- **No delete tools — and no delete capability.** The SnapDeploy server refuses
  destructive actions (deleting containers/databases/domains/accounts, password
  changes, subscription cancellation) for every API-key or token caller. Deleting
  is only possible for a person signed in to the web or mobile app.
- **No secrets in replies.** Environment-variable values and database passwords are
  stripped before anything reaches the assistant — names and "(set)" only.
- **Plan limits are relayed, not retried.** Free accounts get 5 deploys per rolling
  12 hours (failed attempts count) and a monthly free-hours cap. When a limit is hit
  the reply carries SnapDeploy's own message and purchase/assign link ($1 Sprint
  Pack, Always-On) and instructs the assistant not to retry.
