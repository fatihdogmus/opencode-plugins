import { execFile, spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { delimiter, join } from "node:path"

const findBinary = (name: string, override?: unknown) => {
  if (typeof override === "string" && override.trim()) return override.trim().replace(/^~(?=\/)/, homedir())
  const dirs = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
  return dirs.filter(Boolean).map((dir) => join(dir, name)).find((path) => existsSync(path))
}

const run = (command: string, args: string[], input?: string) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    )
    if (input !== undefined) child.stdin?.end(input)
  })

// ffmpeg's microphone input for this OS: the system default device unless `device` names another.
const inputArgs = (device: string | undefined) => {
  // For testing without a microphone: plays a file in real time as if it were spoken.
  const testFile = process.env.OPENCODE_VOICE_INPUT_TEST_FILE
  if (testFile) return ["-re", "-i", testFile]
  if (process.platform === "darwin") return ["-f", "avfoundation", "-i", `:${device || "default"}`]
  if (process.platform === "linux") return ["-f", "pulse", "-i", device || "default"]
  if (process.platform === "win32" && device) return ["-f", "dshow", "-i", `audio=${device}`]
  throw new Error("Set the plugin's `microphone` option to your DirectShow microphone name to record on Windows.")
}

export class FfmpegRecorder {
  private child?: ChildProcess
  private file?: string
  private stderr = ""
  private exited?: Promise<number | null>

  constructor(private readonly options: { ffmpegPath?: unknown; microphone?: unknown }) {}

  async start() {
    const ffmpeg = findBinary("ffmpeg", this.options.ffmpegPath)
    if (!ffmpeg) throw new Error("ffmpeg was not found. Install it (`brew install ffmpeg`) or set the `ffmpegPath` option.")
    const device = typeof this.options.microphone === "string" ? this.options.microphone : undefined
    this.file = join(tmpdir(), `opencode-voice-${randomUUID()}.webm`)
    this.stderr = ""
    const child = spawn(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", ...inputArgs(device), "-ac", "1", "-ar", "16000", "-c:a", "libopus",
        "-b:a", "32k", "-y", this.file],
      { stdio: ["pipe", "ignore", "pipe"] },
    )
    this.child = child
    child.stdin?.on("error", () => undefined)
    child.stderr?.on("data", (chunk) => (this.stderr = (this.stderr + chunk).slice(-2000)))
    this.exited = new Promise((resolve) => {
      child.once("exit", (code) => resolve(code))
      child.once("error", () => resolve(-1))
    })
    // ffmpeg fails within a moment when the device or the microphone permission is missing.
    const early = await Promise.race([this.exited, new Promise((resolve) => setTimeout(() => resolve("running"), 400))])
    if (early !== "running") {
      await this.cleanup()
      throw new Error(`Could not record: ${this.stderr.trim().split("\n").pop() || `ffmpeg exited with ${early}`}`)
    }
  }

  /** Stops recording and returns the WebM/Opus file's contents. */
  async stop() {
    const child = this.child
    const file = this.file
    if (!child || !file) throw new Error("Not recording")
    // "q" makes ffmpeg finish the file properly; SIGINT does the same if it doesn't answer.
    if (child.exitCode === null) child.stdin?.end("q")
    const timer = setTimeout(() => child.kill("SIGINT"), 3000)
    await this.exited
    clearTimeout(timer)
    try {
      return await readFile(file)
    } finally {
      await this.cleanup()
    }
  }

  async cancel() {
    this.child?.kill("SIGKILL")
    await this.cleanup()
  }

  private async cleanup() {
    if (this.file) await rm(this.file, { force: true })
    this.child = undefined
    this.file = undefined
  }
}

const clipboardCommands = () => {
  if (process.platform === "darwin") return { read: ["pbpaste"], write: ["pbcopy"] }
  if (process.platform === "win32")
    return { read: ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"], write: ["clip.exe"] }
  if (process.env.WAYLAND_DISPLAY && findBinary("wl-copy"))
    return { read: ["wl-paste", "--no-newline"], write: ["wl-copy"] }
  if (findBinary("xclip"))
    return { read: ["xclip", "-selection", "clipboard", "-o"], write: ["xclip", "-selection", "clipboard"] }
  return undefined
}

export const clipboard = {
  available: () => clipboardCommands() !== undefined,
  async read() {
    const commands = clipboardCommands()
    if (!commands) return undefined
    const [command, ...args] = commands.read
    return run(command!, args).catch(() => undefined)
  },
  async write(text: string) {
    const commands = clipboardCommands()
    if (!commands) throw new Error("No clipboard tool found (pbcopy, wl-copy or xclip).")
    const [command, ...args] = commands.write
    await run(command!, args, text)
  },
}
