import { readFileSync } from "node:fs"
import { Plugin } from "@opencode/plugin"
import { VoiceRpc, type TranscribeInput, type TranscribeOutput } from "./rpc"

// The ChatGPT backend's one-shot dictation endpoint that Codex Desktop uses (as codex-asr does). It takes the same
// ChatGPT access token as Codex logins: OpenCode's "Codex browser/device code" OpenAI sign-ins.
const CHATGPT_TRANSCRIBE = "https://chatgpt.com/backend-api/transcribe"
const CHATGPT_METHODS = new Set(["chatgpt-browser", "chatgpt-headless"])
// API keys and "Sign in with ChatGPT" (token sharing) tokens are used against the public API.
const OPENAI_TRANSCRIBE = "https://api.openai.com/v1/audio/transcriptions"
const DEFAULT_API_MODEL = "gpt-4o-mini-transcribe"
const CODEX_DESKTOP_VERSION = "26.429.30905"

const codexUserAgent = () => {
  let version = CODEX_DESKTOP_VERSION
  try {
    const plist = readFileSync("/Applications/Codex.app/Contents/Info.plist", "utf8")
    version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? version
  } catch {}
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  return `Codex Desktop/${version} (${os}; ${arch})`
}

const accountFromToken = (token: string) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString())
    const id = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? payload?.chatgpt_account_id
    return typeof id === "string" && id ? id : undefined
  } catch {
    return undefined
  }
}

const extension = (mimeType: string) => {
  if (mimeType.includes("ogg")) return "ogg"
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a"
  if (mimeType.includes("wav")) return "wav"
  if (mimeType.includes("mpeg")) return "mp3"
  return "webm"
}

const clip = (body: string) => body.split(/\s+/).join(" ").slice(0, 300)

class UpstreamError extends Error {}

const upload = async (url: string, headers: Record<string, string>, form: FormData, signal: AbortSignal) => {
  const response = await fetch(url, { method: "POST", headers, body: form, signal })
  const body = await response.text()
  if (!response.ok) throw new UpstreamError(`Transcription failed with HTTP ${response.status}: ${clip(body)}`)
  const parsed = JSON.parse(body) as { text?: unknown }
  if (typeof parsed.text !== "string") throw new UpstreamError("Transcription response did not contain text")
  return parsed.text.trim()
}

const audioForm = (input: TranscribeInput) => {
  const type = input.mimeType.split(";")[0] || "audio/webm"
  const form = new FormData()
  form.append("file", new Blob([Buffer.from(input.audio, "base64")], { type }), `voice.${extension(type)}`)
  if (input.language) form.append("language", input.language)
  return form
}

export default Plugin.define({
  id: "voice-input",
  async setup(ctx) {
    const apiModel = typeof ctx.options.model === "string" && ctx.options.model ? ctx.options.model : DEFAULT_API_MODEL

    const registration = await ctx.rpc.register(VoiceRpc, {
      transcribe: async (raw, call) => {
        const input = raw as TranscribeInput
        const connection = await ctx.integration.connection.active("openai")
        if (!connection) {
          return call.error("no_account", "No OpenAI account is connected", {
            message: "Connect OpenAI with /connect (or `opencode auth login openai`), then try again.",
          })
        }
        const account = connection.type === "credential" ? connection.label : connection.name
        // resolve() refreshes an OAuth token that expires within 5 minutes and saves the rotated refresh token.
        const credential = await ctx.integration.connection.resolve(connection)

        try {
          let text: string
          if (credential?.type === "oauth" && CHATGPT_METHODS.has(credential.methodID)) {
            const accountID = (credential.metadata?.accountID as string | undefined) ?? accountFromToken(credential.access)
            const headers: Record<string, string> = {
              Authorization: `Bearer ${credential.access}`,
              originator: "Codex Desktop",
              "User-Agent": codexUserAgent(),
            }
            if (accountID) headers["ChatGPT-Account-Id"] = accountID
            text = await upload(CHATGPT_TRANSCRIBE, headers, audioForm(input), call.signal)
          } else if (credential?.type === "key" || credential?.type === "oauth") {
            const token = credential.type === "key" ? credential.key : credential.access
            const form = audioForm(input)
            form.append("model", apiModel)
            form.append("response_format", "json")
            text = await upload(OPENAI_TRANSCRIBE, { Authorization: `Bearer ${token}` }, form, call.signal)
          } else {
            return call.error("unsupported_account", "This OpenAI account can't transcribe", {
              message: `The active OpenAI account "${account}" has no usable token. Switch accounts with /connect.`,
            })
          }
          return { text, account } satisfies TranscribeOutput
        } catch (error) {
          if (call.signal.aborted) throw error
          const message = error instanceof Error ? error.message : String(error)
          return call.error("upstream", message, { message: `${message} (account "${account}")` })
        }
      },
    })

    return () => registration.dispose()
  },
})
