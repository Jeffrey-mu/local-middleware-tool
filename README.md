# AI Gateway

Local OpenAI-compatible gateway for Codex, Continue, Cline, Roo Code, Cherry Studio, Open WebUI, Cursor, and any client that supports a custom OpenAI Base URL.

## What It Does

- Exposes one stable endpoint: `http://127.0.0.1:8787/v1`
- Forwards OpenAI-compatible `/v1/*` requests to configured provider base URLs
- Supports streaming pass-through for chat and responses APIs
- Retries and fails over on timeout, `429`, and `5xx`
- Tracks provider health, latency, request counts, failures, and recent logs
- Provides a local dashboard at `http://localhost:8788`

## Run

```bash
npm install
npm run dev
```

Gateway:

```text
http://127.0.0.1:8787/v1
```

Dashboard:

```text
http://localhost:8788
```

## Codex Config

Set Codex or any OpenAI-compatible client to:

```text
base_url = "http://127.0.0.1:8787/v1"
```

Use the provider API key in the dashboard. The gateway will replace inbound authorization with the selected provider key.

## Configuration

The first run creates:

```text
data/gateway.json
```

You can edit providers in the dashboard or directly in JSON.

Provider shape:

```json
{
  "id": "openrouter",
  "name": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "sk-xxxxx",
  "apiKeys": [],
  "priority": 2,
  "weight": 60,
  "timeoutMs": 30000,
  "enabled": true,
  "models": ["*"]
}
```

`baseUrl` is used as configured after removing one trailing slash. Include `/v1` only for providers that require it.

## Routing Strategy

- `priority`: lowest priority number first
- `fastest`: provider with the best measured latency first
- `round-robin`: rotate enabled providers
- `weighted`: higher weight first

Rules can pin model patterns to provider order:

```json
{
  "id": "gpt-route",
  "pattern": "gpt-*",
  "providerIds": ["polo", "openrouter"],
  "enabled": true
}
```

## Next Product Steps

- Tauri 2 shell with tray mode, startup launch, and auto-update
- API key pool UI with cooldown after `429`
- Import/export `gateway.json`
- Model support probing and automatic unsupported-model failover
- Realtime dashboard via WebSocket
- Packaged installers for macOS, Windows, and Linux
