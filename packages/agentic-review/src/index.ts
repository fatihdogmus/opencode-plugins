import { isAbsolute, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Plugin } from "@opencode/plugin"

const DEFAULT_MCP_URL = "http://127.0.0.1:64342/stream"
const MCP_RETRY_MS = 2000
const MCP_RETRY_MAX = 2
const MCP_FAILURE_COOLDOWN_MS = 30000
// OpenCode's built-in tools that change files. `shell` can change files too, but its paths aren't knowable.
const FILE_TOOLS = new Set(["edit", "write", "patch"])
const RECORDED_TOOLS = new Set([...FILE_TOOLS, "shell"])
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

interface ToolCallMeta {
  callId: string
  tool: string
  changedPaths: string[]
  metadataJson: string | null
}

/** One agent turn: one run (execution) of a session, from its first step until it succeeds, fails or is interrupted. */
interface Turn {
  stepId: string
  directory: string
  changedPaths: Set<string>
  toolCalls: ToolCallMeta[]
}

const turnId = () => `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

function textContent(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((item): item is { type?: string; text?: string } => !!item && typeof item === "object")
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
}

/** The files a built-in file tool call changes, as absolute paths. */
export function changedPaths(tool: string, input: unknown, directory: string): string[] {
  if (!FILE_TOOLS.has(tool) || !input || typeof input !== "object") return []
  const args = input as { path?: unknown; patchText?: unknown }
  const paths =
    tool === "patch"
      ? typeof args.patchText === "string"
        ? [...args.patchText.matchAll(PATCH_FILE)].map((match) => match[1]!.trim())
        : []
      : typeof args.path === "string"
        ? [args.path]
        : []
  return [...new Set(paths.map((path) => (isAbsolute(path) ? path : resolve(directory, path))))]
}

/** Calls the Agentic Review IntelliJ plugin's MCP tools, pausing after failures so an absent IDE costs nothing. */
class TurnSnapshotClient {
  private disabledUntil = 0

  constructor(private readonly url: string) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<void> {
    if (Date.now() < this.disabledUntil) return
    for (let attempt = 1; ; attempt++) {
      try {
        await this.call(name, args)
        return
      } catch (error) {
        if (attempt >= MCP_RETRY_MAX) {
          this.disabledUntil = Date.now() + MCP_FAILURE_COOLDOWN_MS
          throw error
        }
        await new Promise((done) => setTimeout(done, MCP_RETRY_MS))
      }
    }
  }

  private async call(name: string, args: Record<string, unknown>) {
    const client = new Client({ name: "agentic-review", version: "1.0.0" }, { capabilities: {} })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)))
      const result = await client.callTool({ name, arguments: args })
      if (result.isError) throw new Error(`MCP tool ${name} returned an error: ${textContent(result.content)[0] ?? "unknown"}`)
    } finally {
      await client.close().catch(() => undefined)
    }
  }
}

export default Plugin.define({
  id: "agentic-review",
  async setup(ctx) {
    const mcp = new TurnSnapshotClient(typeof ctx.options.mcpUrl === "string" ? ctx.options.mcpUrl : DEFAULT_MCP_URL)
    const turns = new Map<string, Turn>()
    // MCP calls for one session run in order; sessions don't wait for each other.
    const queues = new Map<string, Promise<void>>()
    const enqueue = (sessionID: string, call: () => Promise<void>) => {
      const next = (queues.get(sessionID) ?? Promise.resolve()).then(call).catch(() => undefined)
      queues.set(sessionID, next)
      void next.finally(() => {
        if (queues.get(sessionID) === next) queues.delete(sessionID)
      })
    }

    const end = (sessionID: string, status: "completed" | "failed") => {
      const turn = turns.get(sessionID)
      if (!turn) return
      turns.delete(sessionID)
      enqueue(sessionID, () =>
        mcp.callTool("review_turn_snapshot_end", {
          sessionId: sessionID,
          stepId: turn.stepId,
          status,
          projectPath: turn.directory,
          changedPathsJson: JSON.stringify([...turn.changedPaths]),
          toolCallsJson: JSON.stringify(turn.toolCalls),
        }),
      )
    }

    await ctx.tool.hook("execute.after", (event) => {
      if (!RECORDED_TOOLS.has(event.tool)) return
      const turn = turns.get(event.sessionID)
      if (!turn) return
      const paths = event.status === "completed" ? changedPaths(event.tool, event.input, turn.directory) : []
      for (const path of paths) turn.changedPaths.add(path)
      turn.toolCalls.push({ callId: event.id, tool: event.tool, changedPaths: paths, metadataJson: null })
    })

    const controller = new AbortController()
    void (async () => {
      const events = ctx.event.subscribe({
        types: [
          "session.step.started",
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
        ],
        signal: controller.signal,
      })
      for await (const event of events) {
        const sessionID = event.data.sessionID
        if (event.type === "session.step.started") {
          // The stream carries every location's events and each location has its own plugin instance, so only start
          // turns for this one. Execution events carry no location; they end only turns this instance started.
          if (event.location?.directory !== ctx.location.directory || turns.has(sessionID)) continue
          const turn: Turn = {
            stepId: turnId(),
            directory: ctx.location.directory,
            changedPaths: new Set(),
            toolCalls: [],
          }
          turns.set(sessionID, turn)
          enqueue(sessionID, () =>
            mcp.callTool("review_turn_snapshot_begin", {
              sessionId: sessionID,
              stepId: turn.stepId,
              projectPath: turn.directory,
              agent: event.data.agent,
              model: `${event.data.model.providerID}/${event.data.model.id}`,
            }),
          )
        } else if (event.type === "session.execution.succeeded") {
          end(sessionID, "completed")
        } else if (event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
          end(sessionID, "failed")
        }
      }
    })().catch(() => undefined)

    return () => {
      controller.abort()
      for (const sessionID of [...turns.keys()]) end(sessionID, "failed")
    }
  },
})
