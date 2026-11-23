# @fatihdogmus/opencode-message-timestamps

OpenCode TUI plugin that adds each reply's completion time to the assistant footer, after the duration and tokens per
second:

`Build · Claude Opus 5.5 · 12.3s · 35.7 tok/s · 04 Nov 2026, 12:18:03`

- Shows the time in the computer's time zone, including daylight saving changes, without a zone label.
- Uses the saved completion time, falling back to the creation time for retried or interrupted replies, so it also works
  for older replies.
- Doesn't change prompts, saved messages, the database or OpenCode itself, and keeps the footer's own text, colors and
  tokens-per-second setting. The timestamp uses the theme's muted text color.
- Adds timestamps to reply footers only, not to individual tool calls or reasoning.
- Removes its timestamps and frame callback when it's disabled or reloaded.

## Install

Add the package to your global `~/.config/opencode/opencode.json(c)`; the TUI loads the TUI part of every plugin its
server runs:

```sh
opencode plugin add @fatihdogmus/opencode-message-timestamps
```

A TUI that was already open shows the timestamps after it's reopened.

## Compatibility

There is no public plugin slot for the assistant footer. `src/adapter.ts` finds the footer in the TUI's render tree by
its transcript row IDs and the agent name, which are private details of OpenCode's layout. Tested with OpenCode 2.4.0,
with both the new and the previous design. Layouts it doesn't recognize are skipped; an unexpected error turns the
plugin off for that TUI and shows a "Message timestamps disabled" warning. An OpenCode update can require adapting
`src/adapter.ts`.

## For agents

Follow these steps when a user asks you to install this plugin.

1. **Install it globally** with OpenCode's plugin command. It installs the package and adds it to the user's global
   config. Don't edit OpenCode's database or run `npm install` yourself.

   ```sh
   opencode plugin add @fatihdogmus/opencode-message-timestamps
   ```

2. **Verify** that `opencode plugin list` shows `@fatihdogmus/opencode-message-timestamps`. Config changes reload on
   their own; don't restart OpenCode or its service.
3. **Tell the user** to reopen any TUI that was already open; finished replies then show their completion time at the
   end of the footer. There are no options; the time zone is the computer's.

To remove it: `opencode plugin remove @fatihdogmus/opencode-message-timestamps`.

## Develop

```sh
pnpm --filter ./packages/message-timestamps check   # typecheck and tests
```

To try a change, point a `plugins` entry in `~/.config/opencode/cli.json` at this directory and reopen the TUI.
