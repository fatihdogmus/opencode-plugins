/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { VoiceRpc } from "./rpc"
import { clipboard, FfmpegRecorder } from "./tui-audio"

type Phase = "idle" | "starting" | "recording" | "transcribing"

const COMMAND = "voice-input.dictate"
const MAX_RECORDING_MS = 10 * 60_000
// prompt.paste reads the clipboard asynchronously; the previous clipboard text is put back after it has.
const RESTORE_DELAY_MS = 1500

const message = (error: unknown) => {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data
  if (typeof data?.message === "string") return data.message
  return error instanceof Error ? error.message : String(error)
}

export default Plugin.define({
  id: "voice-input.tui",
  setup(context) {
    const options = context.options
    const language = typeof options.language === "string" ? options.language : ""
    const restoreClipboard = options.restoreClipboard !== false
    const recorder = new FfmpegRecorder({ ffmpegPath: options.ffmpegPath, microphone: options.microphone })
    const [phase, setPhase] = createSignal<Phase>("idle")
    const [since, setSince] = createSignal(0)
    const [now, setNow] = createSignal(Date.now())
    let ticker: ReturnType<typeof setInterval> | undefined
    let restoreTimer: ReturnType<typeof setTimeout> | undefined
    let last = ""

    const stopTicker = () => {
      if (ticker) clearInterval(ticker)
      ticker = undefined
    }

    const fail = (error: unknown) => {
      stopTicker()
      setPhase("idle")
      context.ui.toast.show({ variant: "error", title: "Voice input failed", message: message(error) })
    }

    // The TUI plugin API cannot write to the prompt, so the transcript goes through the clipboard and the prompt's own
    // paste command, which inserts it at the cursor. The previous clipboard text is restored afterwards.
    const paste = async (text: string) => {
      const pasteReachable = context.keymap.commands().some((command) => command.id === "prompt.paste")
      const previous = restoreClipboard && pasteReachable ? await clipboard.read() : undefined
      await clipboard.write(text)
      if (!pasteReachable) {
        context.ui.toast.show({ variant: "info", message: "Transcript copied. Paste it into the prompt." })
        return
      }
      context.keymap.dispatch("prompt.paste")
      if (previous === undefined || previous === "") return
      if (restoreTimer) clearTimeout(restoreTimer)
      restoreTimer = setTimeout(() => void clipboard.write(previous).catch(() => undefined), RESTORE_DELAY_MS)
    }

    const start = async () => {
      if (phase() !== "idle") return
      setPhase("starting")
      try {
        await recorder.start()
        const started = Date.now()
        setSince(started)
        setNow(started)
        setPhase("recording")
        ticker = setInterval(() => {
          setNow(Date.now())
          if (Date.now() - started > MAX_RECORDING_MS) void stop()
        }, 500)
      } catch (error) {
        fail(error)
      }
    }

    const stop = async () => {
      if (phase() !== "recording") return
      stopTicker()
      setPhase("transcribing")
      try {
        const audio = await recorder.stop()
        if (audio.byteLength === 0) throw new Error("Nothing was recorded")
        const result = await context.client.rpc(VoiceRpc).transcribe({
          audio: audio.toString("base64"),
          mimeType: "audio/webm",
          language,
        })
        const text = (result as { text: string }).text.trim()
        setPhase("idle")
        if (!text) {
          context.ui.toast.show({ variant: "info", message: "No speech was heard" })
          return
        }
        last = text
        await paste(`${text} `)
      } catch (error) {
        fail(error)
      }
    }

    const cancel = async () => {
      if (phase() !== "recording") return false
      stopTicker()
      await recorder.cancel()
      setPhase("idle")
    }

    const toggle = () => {
      if (phase() === "idle") void start()
      else if (phase() === "recording") void stop()
    }

    const elapsed = () => {
      const seconds = Math.max(0, Math.floor((now() - since()) / 1000))
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: COMMAND,
          title: "Start or stop voice dictation",
          group: "Voice input",
          bind: "<leader>v",
          palette: true,
          slash: { name: "dictate" },
          run: () => toggle(),
        },
        {
          id: "voice-input.copy-last",
          title: "Copy last dictation",
          group: "Voice input",
          palette: true,
          enabled: () => last !== "",
          run: () =>
            void clipboard
              .write(last)
              .then(() => context.ui.toast.show({ variant: "success", message: "Last dictation copied" })),
        },
        {
          id: "voice-input.cancel",
          title: "Cancel voice dictation",
          group: "Voice input",
          palette: true,
          enabled: () => phase() === "recording",
          run: () => void cancel(),
        },
      ],
    }))

    // The footer shows nothing while idle; it only shows that the mic is recording or transcribing.
    const removeSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const theme = context.theme
        const label = () => {
          switch (phase()) {
            case "recording":
              return `● ${elapsed()} stop`
            case "transcribing":
              return "◌ transcribing…"
            case "starting":
              return "◌ mic…"
            default:
              return ""
          }
        }
        const color = () => (phase() === "recording" ? theme.text.feedback.error.base : theme.text.feedback.warning.base)
        return (
          <Show when={phase() !== "idle"}>
            <text fg={color()} onMouseDown={() => toggle()}>
              {label()}
            </text>
          </Show>
        )
      },
    })

    return () => {
      removeSlot()
      stopTicker()
      if (restoreTimer) clearTimeout(restoreTimer)
      void recorder.cancel()
    }
  },
})
