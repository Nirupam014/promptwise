# PromptWise — MCP connector

Run PromptWise as an [MCP](https://modelcontextprotocol.io) connector so **Claude
desktop** (and any MCP client) can call it as tools. Zero dependencies — it's a
stdio JSON-RPC server reusing `@promptwise-dev/core`.

## What it gives Claude

| Tool | What it does |
|------|--------------|
| `optimize_prompt` | tighten a draft prompt; returns the shorter version + token saving |
| `summarize_conversation` | summary + durable facts for a thread or block of text |
| `analyze_context` | flag whether a conversation is too long/repetitive/off-topic |
| `estimate_tokens` | estimate token count of any text |
| `remember` / `recall` / `forget` | persistent facts, **shared with the CLI** (`~/.promptwise/memory.json`) |

## What it can't do (be honest)

A connector **cannot shrink your prompt before you send it** — by the time
Claude calls a tool, your message is already in its context, so the input tokens
are already spent. This adds an on-demand optimization/summarization/memory
toolbox; for true pre-send compression use the browser extension, IDE plugin,
CLI, or the desktop companion.

## Add it to Claude desktop

Edit your Claude desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "promptwise": {
      "command": "node",
      "args": ["/Users/nirupam/workspace/AI/PromptWise/packages/mcp-server/server.js"]
    }
  }
}
```

Then **restart Claude desktop**. You'll see the PromptWise tools available. Try:

> "Use promptwise to optimize this prompt: *could you please kindly help me…*"
> "Remember that we use TypeScript and pnpm."
> "What do you remember about my stack?"

## Run / test manually

It speaks newline-delimited JSON-RPC 2.0 on stdio:

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | node packages/mcp-server/server.js
```

## Notes

- stdout carries the protocol; all logging goes to stderr.
- Memory is the same file the CLI uses, so facts flow between the terminal and
  Claude.
