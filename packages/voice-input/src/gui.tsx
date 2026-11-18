import { createSignal, onCleanup } from "solid-js"
import { Command, ComposerPill, Plugin, Style, type ComposerPillView, type SetupContext } from "@opencode/plugin/gui"
import { Voice } from "./contract"
import { composerOf, CSS, injectComposerButtons, typeInto } from "./inject"
import { isUnavailable, VoiceRpc, whenAvailable } from "./rpc"
import { main } from "./main"

const definition = Plugin.define({
  i18n: {
    en: {
      group: "Voice input",
      "pill.idle": "🎙 Dictate",
      "pill.idle.title": "Record a voice prompt and transcribe it with your OpenAI account",
      "pill.starting": "🎙 Starting…",
      "pill.recording": "Stop {{time}}",
      "pill.recording.title": "Stop recording and transcribe",
      "pill.transcribing": "Transcribing…",
      "button.idle": "Dictate (⌘⌥M)",
      "button.recording": "Stop and transcribe (⌘⌥M)",
      "button.busy": "Transcribing…",
      "command.toggle": "Start or stop voice dictation",
      "command.cancel": "Cancel voice dictation",
      "error.title": "Voice input failed",
      "error.microphone":
        "Microphone access was denied. Allow OpenCode in System Settings › Privacy & Security › Microphone.",
      nospeech: "No speech was heard",
      copied: "No prompt is open, so the transcript was copied to the clipboard",
    },
  },
})

type Ctx = SetupContext<typeof definition>

type Phase = { kind: "idle" } | { kind: "starting" } | { kind: "recording"; since: number } | { kind: "transcribing" }

const MAX_RECORDING_MS = 10 * 60_000
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording"))
    reader.readAsDataURL(blob)
  })

const message = (error: unknown) => {
  if (isUnavailable(error)) return "Voice input is still starting in OpenCode. Try again in a moment."
  // Plugin RPC errors carry the user-facing reason in data.message.
  const data = (error as { data?: { message?: unknown } } | undefined)?.data
  if (typeof data?.message === "string") return data.message
  return error instanceof Error ? error.message : String(error)
}

class Recorder {
  private stream?: MediaStream
  private recorder?: MediaRecorder
  private chunks: Blob[] = []

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(250)
  }

  stop() {
    const recorder = this.recorder
    if (!recorder) return Promise.resolve(undefined)
    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" })
        this.release()
        resolve(blob)
      }
      recorder.stop()
    })
  }

  release() {
    if (this.recorder?.state === "recording") this.recorder.stop()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    this.recorder = undefined
    this.chunks = []
  }
}

const setup = (ctx: Ctx) => {
  const voice = ctx.main(Voice)
  const recorder = new Recorder()
  const [phase, setPhase] = createSignal<Phase>({ kind: "idle" })
  const [now, setNow] = createSignal(Date.now())
  let ticker: ReturnType<typeof setInterval> | undefined
  const [owner, setOwner] = createSignal<HTMLElement>()
  const placement = ctx.options.placement === "pill" ? "pill" : "composer"

  const language = () => (typeof ctx.options.language === "string" ? ctx.options.language : "")

  const stopTicker = () => {
    if (ticker) clearInterval(ticker)
    ticker = undefined
  }

  const fail = (error: unknown) => {
    stopTicker()
    recorder.release()
    setPhase({ kind: "idle" })
    setOwner(undefined)
    ctx.toast.show({ variant: "error", title: ctx.t("error.title"), description: message(error) })
  }

  const insert = (text: string) => {
    if (!text) {
      ctx.toast.show({ title: ctx.t("nospeech") })
      return
    }
    const composer = ctx.screen.current()?.composer
    const target = composerOf(owner())
    // The plugin API reaches the routed session's prompt; a new-session composer is only reachable through the DOM.
    if (!composer && target && typeInto(target, text)) return
    if (!composer) {
      void ctx.system.copy(text)
      ctx.toast.show({ title: ctx.t("copied") })
      return
    }
    const current = composer.text()
    composer.insert(current && !/\s$/.test(current) ? ` ${text}` : text)
    composer.focus()
  }

  const start = async (host?: HTMLElement) => {
    if (phase().kind !== "idle") return
    setOwner(host)
    setPhase({ kind: "starting" })
    try {
      if (!(await voice.requestMicrophone())) throw new Error(ctx.t("error.microphone"))
      await recorder.start()
      const since = Date.now()
      setNow(since)
      setPhase({ kind: "recording", since })
      ticker = setInterval(() => {
        setNow(Date.now())
        if (Date.now() - since > MAX_RECORDING_MS) void stop()
      }, 500)
    } catch (error) {
      fail(error)
    }
  }

  const stop = async () => {
    if (phase().kind !== "recording") return
    stopTicker()
    setPhase({ kind: "transcribing" })
    try {
      const blob = await recorder.stop()
      if (!blob || blob.size === 0) throw new Error(ctx.t("nospeech"))
      const audio = await toBase64(blob)
      const result = await whenAvailable(() =>
        ctx.client.rpc(VoiceRpc).transcribe({ audio, mimeType: blob.type, language: language() }),
      )
      const text = (result as { text: string }).text
      setPhase({ kind: "idle" })
      insert(text)
      setOwner(undefined)
    } catch (error) {
      fail(error)
    }
  }

  const cancel = () => {
    if (phase().kind !== "recording" && phase().kind !== "starting") return false
    stopTicker()
    recorder.release()
    setPhase({ kind: "idle" })
    setOwner(undefined)
  }

  const toggle = (host?: HTMLElement) => {
    const kind = phase().kind
    if (kind === "idle") void start(host ?? hostOfFocusedComposer())
    else if (kind === "recording") void stop()
  }

  const elapsed = (since: number) => {
    const seconds = Math.max(0, Math.floor((now() - since) / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }

  const buttons =
    placement === "composer"
      ? injectComposerButtons({
          phase: () => phase().kind,
          owner,
          elapsed: () => {
            const current = phase()
            return current.kind === "recording" ? elapsed(current.since) : ""
          },
          title: () => {
            const kind = phase().kind
            if (kind === "recording") return ctx.t("button.recording")
            if (kind === "idle") return ctx.t("button.idle")
            return ctx.t("button.busy")
          },
          onClick: (host) => toggle(host),
        })
      : undefined
  if (buttons) ctx.add(Style, CSS)

  function hostOfFocusedComposer() {
    return composerOf(undefined)?.querySelector<HTMLElement>("[data-voice-input]") ?? undefined
  }

  ctx.add(ComposerPill, {
    id: "mic",
    // The pill stands in when the mic can't be placed next to the send button, e.g. after an app update moves it.
    show: (): ComposerPillView | undefined => {
      if (buttons && buttons.count() > 0) return undefined
      const current = phase()
      switch (current.kind) {
        case "idle":
          return {
            label: ctx.t("pill.idle"),
            title: ctx.t("pill.idle.title"),
            run: () => toggle(),
          }
        case "starting":
          return { label: ctx.t("pill.starting") }
        case "recording":
          return {
            label: ctx.t("pill.recording", { time: elapsed(current.since) }),
            title: ctx.t("pill.recording.title"),
            icon: "stop",
            tone: "danger",
            run: () => toggle(),
          }
        case "transcribing":
          return { label: ctx.t("pill.transcribing"), icon: "outline-wave-audio", tone: "warning" }
      }
    },
  })

  ctx.add(Command, (): Command => ({
    id: "toggle",
    title: ctx.t("command.toggle"),
    group: ctx.t("group"),
    keywords: "voice mic microphone dictate speech record transcribe",
    section: "prompt",
    bind: "mod+alt+m",
    editable: true,
    slash: { name: "dictate" },
    run: () => toggle(),
  }))

  ctx.add(Command, (): Command => ({
    id: "cancel",
    title: ctx.t("command.cancel"),
    group: ctx.t("group"),
    section: "prompt",
    enabled: phase().kind === "recording" || phase().kind === "starting",
    run: () => cancel(),
  }))

  onCleanup(() => {
    buttons?.dispose()
    stopTicker()
    recorder.release()
  })
}

export default Plugin.define({ ...definition, setup, main })
