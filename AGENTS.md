# opencode-plugins

pnpm workspace of OpenCode V2 plugins. Each `packages/<id>` publishes as `@fatihdogmus/opencode-<id>`; see `README.md`
for layout, adding a plugin, and releasing.

- Use pnpm, never npm, for installs and scripts (`pnpm install`, `pnpm --filter ./packages/<id> <script>`). The only
  npm calls are the smoke test's consumer-style install and `npm publish` in the Release workflow.
- Run `pnpm check` before finishing a change; run `pnpm package <id>` when a change affects what a package ships.
- Never bump versions, tag, or publish by hand. The Release workflow does it; `scripts/release/` enforces the rules and
  `test/` tests them.
- Package manifests: keep `name`, `license`, `publishConfig`, and `repository` (`url` + `directory`) as
  `scripts/release/validate.mjs` requires.
- Dependency build scripts are denied by default; only add an `allowBuilds` entry in `pnpm-workspace.yaml` when a
  package really needs its install script.
- OpenCode plugin docs: https://opencode.ai/docs/build/plugins (server, TUI, GUI, RPC). Write V2 plugins only
  (`Plugin.define` from `@opencode/plugin`); V1 plugin implementations do not run in V2.
- `ctx.event.subscribe()` streams every location's events. `session.step.*` events carry `location`;
  `session.execution.*` events don't. A run ends with `session.execution.succeeded|failed|interrupted`, not
  `session.idle`.
- A running shared OpenCode service caches a local plugin's `package.json` exports. After adding a new part (`./tui`,
  `./rpc`, …) to a locally loaded plugin, run `opencode service restart` or test with `opencode --standalone`.
