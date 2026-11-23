# OpenCode Codex Guardian

Automatically review coding-agent permission requests with Codex Guardian in OpenCode V2.

The plugin works **inside OpenCode's permission system**, not instead of it:

| OpenCode decision | Plugin behavior |
| --- | --- |
| `allow` | Leave unchanged. |
| `deny` | Leave blocked. |
| `ask` | Review the action and allow, deny, or leave it for human approval. |

This includes out-of-project `external_directory` requests. Approval is scoped to the current request, not blanket access to the filesystem; subsequent read, edit, and shell checks still apply.

> **Free usage is unverified.** Successful `codex-auto-review` responses do not prove zero-cost accounting. `nativeFreeOnly` prevents ordinary-model fallback; it does not guarantee free native inference. Keep the plugin disabled if guaranteed zero-cost usage is required.

## Requirements

- Node.js 26 or newer.
- OpenCode V2; tested with `2.0.24` and `2.0.32`. Plugin API dependency pinned to `2.0.24`.
- For native reviews: the built-in `openai` provider connected through ChatGPT OAuth (the account selected in `/connect`). The main session can use any model; see [How native reviews work](#how-native-reviews-work).

OpenAI API-key connections and custom provider aliases are not supported by the native transport. Backend availability of `codex-auto-review` is not guaranteed.

## Install and enable

Once published, add `@fatihdogmus/opencode-codex-guardian` to your OpenCode plugin configuration. No separate `npm install` is needed.

To use a local checkout instead:

```sh
git clone https://github.com/fatihdogmus/opencode-plugins.git
cd opencode-plugins
pnpm install
pnpm --filter @fatihdogmus/opencode-codex-guardian build
```

Then point the plugin entry at `packages/codex-guardian` in that checkout.

Add this entry to your project `opencode.json(c)` or `.opencode/opencode.json(c)`, preserving existing configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@fatihdogmus/opencode-codex-guardian",
      "options": {
        "enabled": true,
        "transport": "codex-auto-review",
        "nativeFreeOnly": true,
        "failureMode": "ask"
      }
    }
  ]
}
```

For a local checkout, replace the package name with the absolute path to your clone. Relative plugin paths resolve from the configuration file containing the entry. **Loading this plugin enables the hardened baseline by default.** OpenCode does not expose the provenance of plugin options, so options in any OpenCode config are treated as unknown-origin: they may tighten security, not weaken it.

Set trusted policy separately in `~/.config/opencode/codex-guardian.json` (or `$XDG_CONFIG_HOME/opencode/codex-guardian.json`). For example, to evaluate decisions without applying them:

```json
{
  "autoReview": {
    "enabled": true,
    "transport": "codex-auto-review",
    "nativeFreeOnly": true,
    "failureMode": "ask",
    "shadow": true
  }
}
```

This must be a regular, user-owned file outside the project, not a symlink, with no group/other write permission or unsafe writable ancestor directories. Use `chmod 600` on the file. Trusted policy can disable review (`enabled: false`), select a fallback, or change active/shadow mode. **A project `enabled: false` cannot disable an enabled baseline.** An invalid trusted file or malformed options leave the permission hook installed and deny ask-level operations; diagnostics report `configuration_invalid`.

For persistent enforcement, load the plugin from user-controlled global OpenCode configuration. A plugin cannot protect you if the host never loads it or another actor removes its registration.

Check its status in OpenCode:

```text
/auto-review status
```

Status does not trigger inference. Native availability and OAuth diagnostics are populated during actual requests, so an initial `NATIVE_UNAVAILABLE` status alone does not establish that your account is unsupported.

After changing plugin source, run `pnpm build` in `packages/codex-guardian` again. Configuration changes normally reload automatically; changes to an external local plugin may require `opencode service restart`.

## For agents

Follow these steps when a user asks you to install this plugin. It changes how OpenCode handles permission requests,
so don't loosen any security setting the user didn't explicitly ask to change.

1. **Check the OpenAI connection.** Native reviews need the built-in OpenAI provider signed in with ChatGPT
   (`opencode auth list` shows an `OpenAI` row). API-key connections are not supported. If it's missing, ask the user to
   run `/connect` in OpenCode and choose a ChatGPT sign-in; don't start an OAuth flow yourself. The model the user codes
   with doesn't matter: sessions on other providers get standalone reviews through this account.
2. **Install it globally** with OpenCode's plugin command. It installs the package and adds it to the user's global
   config, which is what persistent enforcement needs. Don't edit OpenCode's database or run `npm install` yourself.

   ```sh
   opencode plugin add @fatihdogmus/opencode-codex-guardian
   ```

   The plain entry loads the hardened baseline shown in [Install and enable](#install-and-enable); no options are
   needed. If the user asks for options, replace the entry in `~/.config/opencode/opencode.json(c)` with the object form
   and keep every other entry. Options can only tighten security.
3. **Leave the trusted policy alone** unless the user asks to change it. `~/.config/opencode/codex-guardian.json` is the
   only place that can disable reviews or switch to shadow mode. When the user does ask, write exactly what they asked
   for, then `chmod 600` the file; it must be a regular file the user owns, not a symlink.
4. **Verify** that `opencode plugin list` has a row with the ID `codex-guardian`. Config changes reload on their
   own; don't restart OpenCode or its service.
5. **Tell the user** that `ask`-level permission requests are now reviewed by Codex Guardian, which allows, denies, or
   leaves them for their approval, and that `/auto-review status` in OpenCode shows its state. Free usage is
   unverified, as described above.

To remove it: `opencode plugin remove @fatihdogmus/opencode-codex-guardian`.

## How native reviews work

1. Correlate the proposed action with the main session's OpenAI/Codex response, when the session uses Codex.
2. Check for catastrophic actions and protected resources, then gather user instructions and bounded read-only evidence with best-effort secret redaction.
3. Review the action through `codex-auto-review` in a **fresh, tool-free child session**, using OpenCode's ChatGPT OAuth connection, linked to the parent response when there is one.
4. Validate the assessment, delete the child session, and apply local risk rules. Failures never silently approve an action.
5. Write hashed decision metadata to the audit log. Successful approvals are silent; deny/ask explanations are sanitized.

Native HTTP hooks accept plain JSON and `zstd`, `gzip`, `deflate`, or Brotli-compressed requests. The plugin decodes the body before editing Guardian metadata and removes stale encoding/length headers from the rewritten JSON. Unsupported or malformed bodies fail closed; they never bypass approval.

The reviewer reuses OpenCode's active ChatGPT OAuth connection. It does not require a separate API key and does not use your selected chat model for the review itself. Your selected model continues doing the coding.

The main session's model doesn't matter:

- **A session on OpenAI/Codex** links each review to the exact Codex response that proposed the action. If that response can't be identified exactly (for example, one source message spans several responses), the review fails rather than guessing a link.
- **A session on another provider** (for example, Anthropic) has no Codex responses to link, so the review runs **standalone**: the same `codex-auto-review` model and policy through the connected OpenAI account, without `parent_response_id`. Status and the audit log report it with `parentLinked: false`. Whether standalone reviews are accounted differently from linked ones is unverified, like all accounting.

Without ChatGPT OAuth, native review fails. With the configuration above, failure leaves the request for human approval rather than calling another model.

## Safety and limitations

- Configured denies remain enforced. Only ask-level requests are auto-reviewed.
- A small deterministic preflight denies obvious recursive system-root deletion, block-device formatting/writes, private-key/cloud-credential export, `.env` export, and security-policy destruction. It does not attempt to classify every dangerous operation.
- Protected plugin, OpenCode config, auth, policy and audit paths require human approval. Existing symlink parents are resolved. These checks cannot prove the effects of arbitrary programs or prevent filesystem races; dynamic shell structures, scripts and interpreter code that cannot be normalized conservatively require human approval.
- Reviewer sessions have no tools and cannot recursively authorize their own actions.
- Repository text, tool output, assistant messages, and action metadata are treated as untrusted data, not evidence of user authorization.
- Direct, scoped user requests inform authorization independently of host approval. Only fixed plugin-authored guidance is privileged; repository and tool content cannot become reviewer policy.
- Critical-risk actions are denied. High-risk actions require matching high authorization; insufficiently authorized medium-risk approvals remain `ask`.
- Missing or incomplete context, malformed responses, provider errors, and timeouts use the configured failure mode, defaulting to `ask`. Compacted sessions restore original user turns from a matching authenticated local-service archive; private/remote hosts without that archive stay manual. Summaries never replace earlier restrictions.
- Equivalent denied actions are tracked per session; repeated denials can require human approval.
- Review packets are sent to the chosen model provider. Secret redaction is best effort, not a guarantee that sensitive content cannot be transmitted.
- Model judgments are not a security sandbox. The plugin does not replace operating-system restrictions or guarantee protection against prompt injection.
- OpenCode host APIs and other loaded plugins are trusted. Host approval evidence is short-lived, single-use, and bound to the exact request; transcript claims cannot create it. OpenCode cannot attest whether a human or another plugin supplied a reply.
- Internal reviewers are named child sessions, not hidden sessions. HTTP and experimental WebSocket hooks are supported.

## Configuration

| Option | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` when loaded | Enable permission review; disable only through trusted policy. |
| `transport` | `"auto"` | `auto`, native-only `codex-auto-review`, or ordinary `model`. |
| `nativeFreeOnly` | `true` | Forbid ordinary-model fallback; **not a billing guarantee**. |
| `fallbackModel` | Unset | Explicit `provider/model` for ordinary model reviews. |
| `failureMode` | `"ask"` | Leave failures for human approval, or use `deny`. |
| `timeoutMs` | `15000` | Maximum review time; `reviewer.timeoutMs` is an alias. |
| `contextMaxChars` | `100000` | Maximum serialized review packet size. Optional context is trimmed first; user instructions and exact actions are never truncated. |
| `logging.enabled` | `true` | Log bounded review diagnostics and decisions. |
| `circuitBreaker.enabled` | `true` | Track repeated equivalent denials. |
| `circuitBreaker.maxEquivalentDenials` | `3` | Denial threshold. |
| `circuitBreaker.ttlMs` | `1800000` | Denial tracking window. |
| `circuitBreaker.effect` | `"ask"` | Decision after the threshold is reached. |
| `shadow` / `mode` | `false` / `"active"` | Trusted rollout mode; every ask-level request remains `ask` in shadow mode, including proposed deterministic denials. |
| `preflight.enabled` | `true` | Enable the narrow catastrophic brake. |
| `selfProtection.enabled` | `true` | Prevent automatic approval of protected-resource mutations. |
| `selfProtection.protectedPaths` | `[]` | Additional absolute protected paths; untrusted sources may add, never remove protection. |
| `audit.enabled` | `true` | Durable hashed JSONL decision records; audit failure cannot allow an action. |
| `audit.maxFileSizeMB` / `retainedFiles` | `20` / `5` | Current-log size limit and retained rotated logs. |
| `evidence.enabled` / `filesystem` / `git` | `true` | Bounded local metadata enrichment, not authorization. |
| `evidence.timeoutMs` / `maxBytes` | `750` / `4096` | Evidence time and output limits. |
| `sessionApprovals.enabled` / `ttlMs` | `false` / `60000` | Optional cache for a low-risk, exact bare `git status` only. |

`reviewer.ephemeralSession` and secret redaction cannot be disabled. A malformed or unsupported option is an error, not a silent fallback. Project/unknown options may lower budgets, strengthen failure/breaker behavior, add protected paths, or disable evidence/caching. They cannot enable fallback, disable protection/auditing/breakers, or change active/shadow mode.

Ordinary model review is opt-in **in the trusted policy file**: set `transport` to `model`, provide `fallbackModel`, and set `nativeFreeOnly` to `false`. To permit fallback after a native failure, use `transport: "auto"` with those same fallback settings. Ordinary inference may consume normal model quota or incur charges.

### Audit and evidence

Audit records contain hashed identifiers, decisions, transport, latency, failure stage, and allowlisted error codes—not raw commands, rationale, conversations, credentials, or exception messages. Hashes are not encryption; low-entropy inputs can be guessed. Logs use private permissions, reject symlinks, and rotate under a cross-process lock. A lock left by a crashed process requires manual recovery.

Default audit location:

- Linux: `$XDG_STATE_HOME/opencode/codex-guardian/reviews.jsonl`, or `~/.local/state/opencode/codex-guardian/reviews.jsonl`.
- macOS: `~/Library/Application Support/opencode/codex-guardian/reviews.jsonl`.
- Windows: `%LOCALAPPDATA%/opencode/codex-guardian/reviews.jsonl`.

Read-only evidence gathers bounded filesystem and Git metadata without reading file contents or using the network. Unavailable optional metadata is reported explicitly rather than blocking review; it never grants authorization or lowers risk.

Session caching is off by default and limited to an exact, low-risk bare `git status`. Scripts, wrappers, writes, and other risky operations are never cached. New user instructions or non-read tool completions invalidate entries.

`/auto-review status` reports policy provenance/errors, mode, preflight/self-protection, audit path/health, breaker/cache counts, native linkage/protocol, cleanup failures and the last proposed/effective decision. Free accounting remains `unverified`.

## Development

This package lives in the [opencode-plugins](https://github.com/fatihdogmus/opencode-plugins) monorepo. From the
repository root:

```sh
pnpm install
pnpm --filter @fatihdogmus/opencode-codex-guardian check
pnpm package codex-guardian
```

`check` runs TypeScript checking, tests, and the build. `pnpm package codex-guardian` packs the plugin into
`artifacts/` and smoke-tests it: the tarball installs and works without TypeScript tooling or install scripts
(`scripts/smoke.mjs` holds the Guardian-specific checks).

### Live integration checks

From `packages/codex-guardian`:

```sh
pnpm verify:live
AUTO_REVIEW_TEST_TRANSPORT=websocket pnpm verify:live
pnpm verify:code-mode
```

These checks use real inference and temporary sessions; the execution probe permits only a harmless `printf`. They are not part of CI. Do not edit or rebuild the plugin during a live run.

## Build and release workflows

Builds and releases run from the monorepo's workflows; see the
[repository README](https://github.com/fatihdogmus/opencode-plugins#releasing). Releases are tagged
`codex-guardian-vX.Y.Z`. Versions up to `v0.3.2` were released from the former
`fatihdogmus/opencode-codex-guardian` repository.

## License

[MIT](LICENSE) © Muhammed Fatih Doğmuş.
