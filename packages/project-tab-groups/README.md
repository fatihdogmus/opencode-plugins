# @fatihdogmus/opencode-project-tab-groups

OpenCode Desktop plugin that groups the tab strip by project.

- **Auto-grouping:** keeps each project's tabs next to each other with `ctx.tabs.move`. Groups keep the order of their
  first tab, so dragging a group's first tab moves the whole group, and a tab dragged out of its group snaps back.
- **Colors, dividers and labels:** injected CSS that targets the app's `[data-titlebar-tab-slot][data-tab-key]`
  elements. This relies on internal DOM, not the plugin API, so an app update can break it. Works with horizontal and
  vertical tabs.
- **Grouped switcher:** the **Switch tab by project…** command opens a searchable list of open tabs under project
  headings. Bind a key in **Settings > Shortcuts**.
- **Settings > Project tab groups** turns each part on or off.

Sessions are grouped by their server project (worktrees join their main repo). Sessions without a project are grouped
by directory. Labels use the sidebar's project name when one is known.

## Install

Add the package to your global `~/.config/opencode/opencode.json(c)`. OpenCode Desktop loads GUI plugins only from the
global config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@fatihdogmus/opencode-project-tab-groups"],
}
```

OpenCode installs the package itself; no separate `npm install` is needed. The plugin has no effect in the TUI.

## For agents

Follow these steps when a user asks you to install this plugin.

1. **Install it globally** with OpenCode's plugin command. It installs the package and adds it to the user's global
   config. Never add this plugin to a project config: OpenCode Desktop loads GUI plugins only from the global config.
   Don't edit OpenCode's database or run `npm install` yourself.

   ```sh
   opencode plugin add @fatihdogmus/opencode-project-tab-groups
   ```

2. **Verify** that `opencode plugin list` has a row with the ID `project-tab-groups`. Config changes reload on their
   own; don't restart OpenCode or its service.
3. **Tell the user** that OpenCode Desktop now groups tabs by project, that **Settings > Project tab groups** turns each
   part on or off, and that they can bind a key to **Switch tab by project…** in **Settings > Shortcuts**. It only
   affects the desktop app, not the TUI.

To remove it: `opencode plugin remove @fatihdogmus/opencode-project-tab-groups`.

## Develop

This package lives in the [opencode-plugins](https://github.com/fatihdogmus/opencode-plugins) monorepo. From the
repository root:

```sh
pnpm install
pnpm --filter @fatihdogmus/opencode-project-tab-groups check   # typecheck + build the desktop bundle
pnpm --filter @fatihdogmus/opencode-project-tab-groups dev     # vite build --watch; each rebuild reloads the GUI
```

To try a local checkout, point the global plugin entry at `packages/project-tab-groups` instead of the package name.

`src/index.ts` is a server part that only declares the plugin ID, `project-tab-groups`. A GUI-only plugin takes the npm
package name as its ID instead; keeping the old ID preserves users' settings and shortcut bindings.

## License

[MIT](LICENSE) © Muhammed Fatih Doğmuş.
