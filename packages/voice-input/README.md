# voice-input

OpenCode plugin that adds voice prompts to OpenCode Desktop, transcribed with the OpenAI account selected in OpenCode.

- **Mic button** next to the send button. Click to record (it turns red with a timer), click again to transcribe. The
  text is typed into the prompt at the cursor for you to review and send (nothing is sent automatically). Works in
  session composers and the new-session composer.
  - This placement uses the composer's internal DOM, not the plugin API: the button is inserted into the static toolbar
    row before `[data-slot="composer-actions"]` and styled with the app's `icon-button-v2` styles. If an app update
    moves that element, the plugin falls back to a **🎙 Dictate** pill above the composer (plugin API), so it keeps
    working.
  - Set `"placement": "pill"` in the options to use only the pill.
- **Shortcut** `⌘⌥M` (changeable in **Settings > Shortcuts**), also `/dictate` and the command palette.
- **Cancel voice dictation** discards a recording in progress.

## TUI

The same package has a `./tui` part (`src/tui.tsx`), which the TUI loads automatically because the plugin is in the
server's config.

- **`🎙 ctrl+x v`** in the prompt footer: click it or press `<leader>v` to start recording; it shows `● 0:07 stop`
  while recording. Also `/dictate`, and **Cancel voice dictation** / **Copy last dictation** in the command palette.
  Rebind it in `cli.json` under `keybinds` as `"voice-input.dictate"`.
- Recording uses `ffmpeg` (`brew install ffmpeg`) with the system default microphone (macOS AVFoundation, Linux
  PulseAudio). macOS asks for microphone access for your terminal app the first time.
- The TUI plugin API cannot write to the prompt, so the transcript is put on the clipboard and the TUI's own
  `prompt.paste` command inserts it at the cursor. Your previous clipboard text is restored 1.5 s later (set
  `"restoreClipboard": false` to keep the transcript on the clipboard). If the paste can't happen, **Copy last
  dictation** copies it again.
- After adding the `./tui` export to an already running shared service, run `opencode service restart` once: Bun
  caches `package.json` exports, so the running service doesn't see the new part until it restarts.
- For testing without a microphone, `OPENCODE_VOICE_INPUT_TEST_FILE=/path/to/audio opencode` records that file instead.

## How transcription works

The window records WebM/Opus with `MediaRecorder` and sends it to the plugin's server part (`src/index.ts`) through
its RPC, `voice-input.transcribe`:

1. `ctx.integration.connection.active("openai")` returns the OpenAI account selected in OpenCode (`/connect`,
   `opencode auth switch openai <label>`).
2. `ctx.integration.connection.resolve(connection)` returns its credential. OpenCode refreshes an OAuth token that
   expires within 5 minutes and stores the rotated refresh token, so the plugin never refreshes tokens itself.
3. The audio is uploaded depending on the account's sign-in method:
   - **Codex browser / device code** (`chatgpt-browser`, `chatgpt-headless`): `POST
     https://chatgpt.com/backend-api/transcribe` with the ChatGPT access token, `ChatGPT-Account-Id`,
     `originator: Codex Desktop` and a Codex Desktop user agent, as [codex-asr](https://github.com/Wangnov/codex-asr)
     does. This is Codex Desktop's dictation endpoint; it is not a public API and can change.
   - **API key**, `OPENAI_API_KEY`, or **Sign in with ChatGPT** (token sharing): `POST
     https://api.openai.com/v1/audio/transcriptions` with model `gpt-4o-mini-transcribe` (option `model`).

The token stays in the OpenCode server; the window only sends audio and receives text.

Test it without the GUI:

```sh
opencode api post /api/rpc/voice-input/transcribe --data '{"input":{"audio":"<base64>","mimeType":"audio/webm"}}'
```

## Options

```jsonc
{
  "plugins": [
    {
      "package": "/Users/fatih/opencode-voice-input",
      "options": {
        "language": "tr", // optional language hint
        "model": "gpt-4o-mini-transcribe", // public-API model for API-key / token-sharing accounts
        "placement": "composer", // desktop: "composer" (mic next to send, default) | "pill"
        "microphone": "default", // TUI: ffmpeg input device (avfoundation index/name, pulse source, or dshow name)
        "ffmpegPath": "/opt/homebrew/bin/ffmpeg", // TUI: optional
        "restoreClipboard": true, // TUI: put the previous clipboard text back after pasting
      },
    },
  ],
}
```

## Files

- `src/index.ts`: server part, the `voice-input.transcribe` RPC.
- `src/rpc.ts`: the RPC contract.
- `src/gui.tsx`: window part: recorder, commands, pill, inserting the text.
- `src/inject.tsx`: the mic button next to the send button.
- `src/tui.tsx`, `src/tui-audio.ts`: TUI part: footer mic, commands, ffmpeg recorder, clipboard paste.
- `src/main.ts`, `src/contract.ts`: asks macOS for microphone access from the app's main process.

## Develop

```sh
npm install
npm run dev        # vite build --watch; each rebuild reloads the GUI in every window
npm run typecheck
```
