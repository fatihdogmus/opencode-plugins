import { systemPreferences } from "electron"
import type { Plugin } from "@opencode/plugin/gui"
import { Voice } from "./contract"

export const main: Plugin.MainSetup = (ctx) => {
  ctx.provide(Voice, {
    requestMicrophone: async () => {
      if (process.platform !== "darwin") return true
      if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true
      return systemPreferences.askForMediaAccess("microphone")
    },
  })
}
