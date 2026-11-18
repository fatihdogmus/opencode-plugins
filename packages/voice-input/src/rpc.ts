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
