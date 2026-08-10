# openapi-mcp-bridge

> A Model Context Protocol (MCP) server that ingests any OpenAPI 3.0/3.1 specification (YAML or JSON) at runtime and dynamically exposes every endpoint as a fully validated MCP tool for LLMs.

Instead of hand-writing tool wrappers for each REST endpoint, point the bridge at an OpenAPI spec once — a local file or a remote URL — and it translates every operation into a typed, validated MCP tool automatically.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [MCP Client Configuration](#mcp-client-configuration)
- [Configuration & Environment Variables](#configuration--environment-variables)
- [Tool Mapping](#tool-mapping)
- [Security & Limits](#security--limits)
- [License](#license)

## Features

- **Dynamic spec ingestion** — loads OpenAPI 3.0.x and 3.1.x specs (JSON or YAML) from a local file path or a remote `http(s)://` URL at startup.
- **Zero glue code** — every operation in the spec becomes an MCP tool automatically; there is nothing to code per endpoint.
- **Type-safe input schemas** — path, query, header, and cookie parameters become top-level tool properties; the request body is exposed as a `body` property. Required fields are enforced.
- **Draft-07 compatible schema normalization** — OpenAPI 3.0 constructs such as `nullable: true` and boolean `exclusiveMinimum`/`exclusiveMaximum` are converted to JSON Schema the MCP/LLM layer understands.
- **`$ref` resolution** — local component references (`#/components/schemas/...`) are dereferenced recursively, with cycle and depth guards.
- **Input validation** — LLM-supplied arguments are validated against the generated JSON Schema with AJV (formats included) _before_ any network call; validation failures are returned as readable tool errors.
- **Automatic HTTP execution** — path parameters are URL-encoded and substituted, query/header/cookie parameters are serialized, and request bodies are sent as JSON with the correct `Content-Type`.
- **Base URL override** — point the bridge at a different environment (staging, a local mock, an authenticated proxy) without editing the spec.
- **Response sanitization** — responses are compacted before reaching the LLM: depth, array length, string length, and total character budgets keep large payloads from blowing up the model's context window. A `[truncated]` marker is appended when content is cut.
- **Built-in `health` tool** — a no-op bootstrap tool to verify the server is responding.
- **Graceful failure handling** — spec load/parse, validation, and HTTP errors are converted into structured MCP tool errors instead of crashing.
- **Insecure HTTP allowed** — optional flag to permit plain `http://` targets.

## How It Works

```
OpenAPI spec (file or URL)
        │
        ▼
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ Spec Loader       │───▶│ Parser            │───▶│ Schema Builder    │
│ (YAML/JSON, $ref  │    │ (3.0/3.1, ops →   │    │ (OpenAPI schema → │
│  dereference)     │    │  tool metadata)   │    │  MCP JSON Schema) │
└───────────────────┘    └───────────────────┘    └───────────────────┘
                                                          │
                                                          ▼
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ MCP Server        │    │ Validator (AJV)   │    │ HTTP Executor     │
│ (stdio, one tool  │───▶│ (reject bad args) │───▶│ (call the API)    │
│  per operation)   │    └───────────────────┘    └─────────┬─────────┘
└───────────────────┘                                       ▼
                                                    ┌───────────────────┐
                                                    │ Sanitizer        │
                                                    │ (bounded response│
                                                    │  for LLM context) │
                                                    └───────────────────┘
```

1. **Load** — the spec is read from a file or fetched over HTTP(S) and parsed as JSON or YAML.
2. **Parse** — each path/verb pair becomes a `ParsedOperation`; `$ref`s are resolved, parameters merged, and tool names derived from `operationId`.
3. **Build schemas** — operation schemas are normalized and converted into the JSON Schema input contract for each MCP tool.
4. **Serve** — an MCP stdio server registers a `health` tool plus one tool per operation.
5. **Validate** — on each tool call, arguments are checked against the input schema with AJV before anything hits the network.
6. **Execute** — a real HTTP request is built (URL, headers, query, cookies, JSON body) and dispatched with a timeout.
7. **Sanitize** — the response body is compacted/truncated under configurable budgets and returned to the model, along with the HTTP status.

## Requirements

- Node.js `>= 20.19` (ESM, built-in `fetch`)
- An OpenAPI 3.0.x or 3.1.x specification, as JSON or YAML

## Installation

The package is published to npm and ships a `dist` build with a CLI binary.

### Global install

```bash
npm install -g openapi-mcp-bridge
```

### Run-on-demand with npx

```bash
npx openapi-mcp-bridge --spec ./openapi.yaml
```

### From source

```bash
npm install
npm run build
npm run start -- --spec ./openapi.yaml
```

## CLI Usage

```
openapi-mcp-bridge [options] [source]
```

| Argument             | Description                                   |
| -------------------- | --------------------------------------------- |
| `-s, --spec <src>`   | Path to the spec file or an `http(s)://` URL. |
| `<src>` (positional) | Same as `--spec`.                             |
| `--help`             | Show usage.                                   |

The spec source can also be provided via the `OPENAPI_SOURCE` environment variable. The CLI flag (or positional argument) takes precedence.

```bash
# Local file spec
openapi-mcp-bridge --spec ./openapi.yaml

# Remote spec URL
openapi-mcp-bridge --spec https://api.example.com/openapi.json

# Env-driven
OPENAPI_SOURCE=./openapi.yaml openapi-mcp-bridge
```

## MCP Client Configuration

`openapi-mcp-bridge` is a **stdio** MCP server, so it plugs into MCP-compatible clients (Claude Desktop, Cursor, VS Code Copilot, homegrown agents, etc.) as a stdio subprocess.

### Claude Desktop

Open `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "openapi-bridge": {
      "command": "openapi-mcp-bridge",
      "args": ["--spec", "/absolute/path/to/openapi.yaml"],
      "env": {
        "API_BASE_URL": "https://api.example.com"
      }
    }
  }
}
```

### Generic / JSON MCP client

```json
{
  "mcpServers": {
    "openapi-bridge": {
      "command": "openapi-mcp-bridge",
      "args": ["--spec", "https://api.example.com/openapi.json"]
    }
  }
}
```

### If the binary is not globally installed

Use plain `node`:

```json
{
  "mcpServers": {
    "openapi-bridge": {
      "command": "node",
      "args": ["/path/to/openapi-mcp-bridge/dist/index.js", "--spec", "./openapi.yaml"]
    }
  }
}
```

> Note: the tool list is fixed at startup — restart the MCP client whenever the upstream spec changes.

## Configuration & Environment Variables

The server is configured once at startup through environment variables (and the CLI `source` argument).

| Variable                     | Default              | Description                                                                                        |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `OPENAPI_SOURCE`             | _(required)_         | Spec path or `http(s)://` URL to load at startup.                                                  |
| `API_BASE_URL`               | from spec            | Overrides the `servers[0].url` of the spec for every request.                                      |
| `API_TIMEOUT_MS`             | `30000`              | Per-request timeout for calls to the target API.                                                   |
| `API_MAX_RESPONSE_CHARS`     | unlimited            | Total character budget for sanitized responses returned to the model.                              |
| `SANITIZE_MAX_DEPTH`         | unlimited            | Max nesting depth kept when compacting JSON responses.                                             |
| `SANITIZE_MAX_ARRAY_LENGTH`  | unlimited            | Max number of array elements kept per array.                                                       |
| `SANITIZE_MAX_STRING_LENGTH` | unlimited            | Max length of an individual string value.                                                          |
| `LOG_LEVEL`                  | `info`               | `debug`, `info`, `warn`, or `error`.                                                               |
| `SERVER_NAME`                | `openapi-mcp-bridge` | MCP server name reported to the client.                                                            |
| `SERVER_VERSION`             | `0.1.0`              | MCP server version reported to the client.                                                         |
| `ALLOW_INSECURE_HTTP`        | `false`              | When `true`, permits `http://` spec sources and target APIs; otherwise those requests are refused. |

Example:

```bash
export OPENAPI_SOURCE=https://petstore.swagger.io/v2/swagger.json
export API_BASE_URL=https://localhost:8080
export API_TIMEOUT_MS=15000
export API_MAX_RESPONSE_CHARS=50000
export LOG_LEVEL=debug
openapi-mcp-bridge
```

> When `API_BASE_URL` is set, every tool call is routed to that base URL regardless of what the spec declares, which is handy for mocking, staging, or authenticated gateways.

## Tool Mapping

- **Tool name** — derived from the operation's `operationId` (normalized to camelCase); falls back to `<method>_<path>` when no `operationId` exists. Collisions get a numeric suffix (`getUser`, `getUser2`, …).
- **Tool description** — `HTTP <METHOD> <path>`, plus the operation `summary` and `description`.
- **Input schema** — one property per path/query/header/cookie parameter (required ones listed under `required`), and a single `body` property for operations with a request body (required when the spec marks it so). `additionalProperties` is disabled.
- **Built-in tools** — a `health` tool with an optional `echo` string argument lets clients probe connectivity.

Example effect for a hypothetical `GET /pets/{petId}` with an `order` query param:

```
MCP tool: getPetById
Input:    { petId: string (required), order?: string }
```

## Security & Limits

- Spec loading supports both local files and remote URLs; remote fetches honor `API_TIMEOUT_MS`, and `http://` sources are refused unless `ALLOW_INSECURE_HTTP=true`.
- Requests to the target API are made with the built-in `fetch` and a timeout; slow or failing upstreams surface as structured tool errors. Plain `http://` targets are refused unless `ALLOW_INSECURE_HTTP=true`.
- Responses are bounded (depths, array/string lengths, total chars) so models are not flooded with huge payloads — and truncation is always flagged.
- Argument validation happens before any external call, rejecting malformed input early.
- To talk to `http://` endpoints (e.g., local mocks), set `ALLOW_INSECURE_HTTP=true`.

## License

[MIT](LICENSE)
