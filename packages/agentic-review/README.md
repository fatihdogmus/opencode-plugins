# @fatihdogmus/opencode-agentic-review

OpenCode plugin for the [Agentic Review](https://plugins.jetbrains.com/plugin/31653-agentic-review) IntelliJ plugin
([source](https://github.com/fatihdogmus/intellij-agentic-review)). It records each agent step as a **turn snapshot**,
so the IDE's **Turn** dropdown can show only the files a single agent turn changed.

> [!WARNING]
> This plugin still uses the OpenCode **V1** plugin API (a function returning hooks). V1 plugin implementations do not
> run in OpenCode V2, so it must be ported to `Plugin.define` from `@opencode/plugin` before it works on V2. See
> [Migrate plugins from V1](https://opencode.ai/docs/build/plugins/migrate-v1).

## How it works

The plugin follows OpenCode's session lifecycle. For every agent step it calls the IntelliJ MCP server's
`review_turn_snapshot_begin` and `review_turn_snapshot_end` tools at `http://127.0.0.1:64342/stream`, sending the files
the agent changed through `edit`, `write`, `apply_patch` and `bash`, the step's timing, and its tool calls.

When the IDE's MCP server is unreachable, the plugin retries briefly, then pauses for 30 seconds. OpenCode keeps working
either way.

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

## Develop

From the repository root:

```sh
pnpm install
pnpm --filter @fatihdogmus/opencode-agentic-review build
```

## License

[MIT](LICENSE) © Muhammed Fatih Doğmuş.
