import { Rpc } from "@opencode/plugin/rpc"

const reason = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
} as const

export const VoiceRpc = Rpc.define({
  id: "voice-input",
  methods: {
    transcribe: {
      input: {
        type: "object",
        properties: {
          audio: { type: "string", description: "Base64-encoded recording" },
          mimeType: { type: "string" },
          language: { type: "string" },
        },
        required: ["audio", "mimeType"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          text: { type: "string" },
          account: { type: "string" },
        },
        required: ["text", "account"],
        additionalProperties: false,
      },
      errors: {
        no_account: reason,
        unsupported_account: reason,
        upstream: reason,
      },
    },
  },
  events: {},
})

export interface TranscribeInput {
  audio: string
  mimeType: string
  language?: string
}

export interface TranscribeOutput {
  text: string
  account: string
}

// OpenCode starts an idle location's plugins on demand. The first call after a while can reach the location before this
// plugin has registered its RPC there, which fails with rpc.unavailable for roughly the first second or two.
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 2000, 2000]

export const isUnavailable = (error: unknown) => (error as { type?: unknown } | undefined)?.type === "rpc.unavailable"

/** Runs an RPC call, retrying while the plugin's RPC is still being registered (about 8 seconds at most). */
export async function whenAvailable<T>(
  call: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await call()
    } catch (error) {
      if (!isUnavailable(error)) throw error
      await wait(delay)
    }
  }
  return call()
}
