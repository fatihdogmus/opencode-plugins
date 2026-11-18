import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

export const Voice = Ipc.define({
  id: "voice-input.voice",
  methods: {
    requestMicrophone: { output: Schema.Boolean },
  },
})
