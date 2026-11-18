# opencode-plugins

[OpenCode](https://opencode.ai) plugins, each published to npm under the `@fatihdogmus` scope.

| Package | Description |
| --- | --- |
| [`@fatihdogmus/opencode-codex-guardian`](packages/codex-guardian) | Codex Guardian permission reviews for OpenCode V2 |
| [`@fatihdogmus/opencode-voice-input`](packages/voice-input) | Voice prompts for OpenCode Desktop and the TUI, transcribed with your OpenAI account |
| [`@fatihdogmus/opencode-agentic-review`](packages/agentic-review) | Turn snapshots for the Agentic Review IntelliJ plugin |

Install a plugin with `opencode plugin add <package>`, or add its package name to `plugins` in your `opencode.json(c)`;
OpenCode installs it itself. Each package's README covers its requirements and options.

**For agents:** to install one of these plugins, follow the **For agents** section of that package's README. It lists
what to check first, the install command, how to verify it, and what not to change.

## Layout

```
packages/<id>/          one plugin, published as @fatihdogmus/opencode-<id>
  package.json          build, typecheck, test and check scripts
  scripts/smoke.mjs     optional checks run against the installed tarball
scripts/release/        shared bump, validate, pack and smoke-test tooling
test/                   tests for the release tooling and workflows
.github/workflows/      Build (every push and PR) and Release (manual)
```

The repository is a [pnpm workspace](https://pnpm.io/workspaces). Each package declares its own dependencies; pnpm keeps
them isolated, so packages can pin different `@opencode/plugin` and TypeScript versions.

## Develop

Requires Node.js 26 and pnpm (the version in `packageManager` is picked up automatically).

```sh
pnpm install
pnpm check                      # release-tooling tests, then every package's check
pnpm --filter ./packages/voice-input check
pnpm package                    # pack every package into artifacts/ and smoke-test each tarball
pnpm package codex-guardian     # just one
```

To try a package locally in OpenCode, point a `plugins` entry at its directory, for example
`/path/to/opencode-plugins/packages/voice-input`.

Dependency install scripts are off unless listed in `allowBuilds` in `pnpm-workspace.yaml`. When `pnpm install` stops on a
new dependency's build script, allow it there only if the package actually needs it.

## Add a plugin

1. Create `packages/<id>` with a `package.json` named `@fatihdogmus/opencode-<id>`, version `0.1.0`, `"license": "MIT"`,
   `publishConfig` (`access: public`, `registry: https://registry.npmjs.org/`), `repository` with
   `url: git+https://github.com/fatihdogmus/opencode-plugins.git` and `directory: packages/<id>`, `exports`, and `files`.
2. Add `build`/`typecheck`/`test` scripts as needed and a `check` script that runs them.
3. Add a `README.md` with a `## For agents` section: the prerequisites to check, `opencode plugin add <package>`, how to
   verify with `opencode plugin list`, what an agent must not change, and `opencode plugin remove <package>`.
4. Copy the root `LICENSE` into the package.
5. Add `<id>` to the `package` options in `.github/workflows/release.yml`.

`pnpm check` fails until the manifest passes release validation, the README has its agent section, and the workflow
lists the package.

## Releasing

Run the **Release** workflow on `main` and choose the package and a `patch`, `minor` or `major` bump. It:

1. checks npm credentials, bumps the package's `version`, and requires a new `<id>-vX.Y.Z` tag;
2. runs the release-tooling tests and the package's `check`, packs it, and smoke-tests the tarball;
3. commits only that package's `package.json` as `github-actions[bot]` and pushes the commit and tag atomically;
4. publishes the tested tarball to npm with provenance, then creates a GitHub release with notes since the package's
   previous tag.

One-time setup in the GitHub repository:

- an `npm` environment, and an `NPM_TOKEN` secret (repository- or environment-scoped): an npm granular token with
  read/write access to the `@fatihdogmus` scope and **Bypass 2FA**, allowed to create new packages for first releases;
- branch and tag rules that let the workflow's `GITHUB_TOKEN` push to `main` and create tags. The workflow never
  force-pushes.

Checks pass before anything is pushed. npm and GitHub publication are not atomic: if publishing fails after the push,
the version commit and tag remain; publish the saved tarball from the workflow artifact rather than bumping again. An
npm version cannot be overwritten.

## License

[MIT](LICENSE) © Muhammed Fatih Doğmuş.
