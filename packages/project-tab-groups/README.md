# project-tab-groups

OpenCode Desktop GUI plugin (`./gui-experimental`, built against `@opencode/plugin` 2.2.0) that groups the shell tab
strip by project.

- **Auto-grouping:** keeps each project's tabs next to each other with `ctx.tabs.move`. Groups keep the order of their
  first tab, so dragging a group's first tab moves the whole group, and a tab dragged out of its group snaps back.
- **Colors, dividers and labels:** injected CSS that targets the app's `[data-titlebar-tab-slot][data-tab-key]`
  elements. This relies on internal DOM, not the plugin API, so an app update can break it. Works with horizontal and
  vertical tabs.
- **Grouped switcher:** the **Switch tab by project…** command opens a searchable
  list of open tabs under project headings. Bind a key in **Settings > Shortcuts**.
- **Settings > Project tab groups** turns each part on or off.

Sessions are grouped by their server project (worktrees join their main repo). Sessions without a project are grouped
by directory. Labels use the sidebar's project name when one is known.

## Develop

```sh
npm install
npm run dev        # vite build --watch; each rebuild reloads the GUI in every window
npm run typecheck
```

Loaded from the global `~/.config/opencode/opencode.json`:

```jsonc
{ "plugins": ["/Users/fatih/opencode-project-tabs"] }
```
