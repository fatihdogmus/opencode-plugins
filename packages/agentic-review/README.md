# @fatihdogmus/opencode-agentic-review

OpenCode V2 plugin for the [Agentic Review](https://plugins.jetbrains.com/plugin/31653-agentic-review) IntelliJ plugin
([source](https://github.com/fatihdogmus/intellij-agentic-review)). It records each agent turn as a **turn snapshot**,
so the IDE's **Turn** dropdown can show only the files a single agent turn changed.

## How it works

A turn is one run of a session: it starts with the run's first model step and ends when the run succeeds, fails, or is
interrupted.

- On the first `session.step.started` of a run, the plugin calls the IDE's `review_turn_snapshot_begin` MCP tool with
  the session, the project directory, the agent, and the model.
- While the run lasts, an `execute.after` tool hook collects the files changed by OpenCode's `write`, `edit`, and `patch`
  tools as absolute paths, and records those calls and `shell` calls.
- On `session.execution.succeeded` it calls `review_turn_snapshot_end` with status `completed`; on
  `session.execution.failed` or `session.execution.interrupted`, with status `failed`.

Each OpenCode location (project directory) runs its own instance of the plugin, which only records that location's
sessions. When the IDE's MCP server is unreachable, the plugin retries briefly, then pauses for 30 seconds; OpenCode keeps
working either way.

## Install

1. Install the Agentic Review plugin in IntelliJ and enable the built-in MCP server.
2. Add the plugin to your OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@fatihdogmus/opencode-agentic-review"],
}
```

OpenCode installs the package itself; no separate `npm install` is needed.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "@fatihdogmus/opencode-agentic-review",
      // The IDE's MCP endpoint. Defaults to IntelliJ's built-in MCP server.
      "options": { "mcpUrl": "http://127.0.0.1:64342/stream" },
    },
  ],
}
```

## Develop

From the repository root:

```sh
pnpm install
pnpm --filter @fatihdogmus/opencode-agentic-review check
```

The tests run the plugin's `setup` against a fake OpenCode context that replays V2 event and tool-hook shapes, and a
real MCP server over Streamable HTTP standing in for the IDE.

## License

[MIT](LICENSE) © Muhammed Fatih Doğmuş.
