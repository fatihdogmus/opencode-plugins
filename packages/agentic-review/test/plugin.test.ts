import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server as HttpServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import plugin, { changedPaths } from "../src/index.ts"

type Call = { name: string; args: Record<string, any> }

/** A stand-in for the IntelliJ plugin's MCP endpoint that records the turn snapshot calls. */
async function fakeIde() {
  const calls: Call[] = []
  const http: HttpServer = createServer(async (req, res) => {
    const server = new Server({ name: "fake-ide", version: "1.0.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls.push({ name: request.params.name, args: request.params.arguments ?? {} })
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, turnId: "t" }) }] }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on("close", () => void transport.close())
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done))
  const { port } = http.address() as AddressInfo
  return { calls, url: `http://127.0.0.1:${port}/stream`, close: () => new Promise((done) => http.close(done)) }
}

/** The parts of the V2 plugin context the plugin uses, driven by the test. */
function fakeContext(mcpUrl: string) {
  const queue: any[] = []
  let wake: (() => void) | undefined
  let afterTool: ((event: any) => void) | undefined
  const ctx = {
    options: { mcpUrl },
    location: { directory: "/repo" },
    tool: {
      hook: async (name: string, callback: (event: any) => void) => {
        assert.equal(name, "execute.after")
        afterTool = callback
        return { dispose() {} }
      },
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) =>
        (async function* () {
          while (!signal.aborted) {
            if (queue.length) yield queue.shift()
            else await new Promise<void>((done) => (wake = done))
          }
        })(),
    },
  }
  return {
    ctx,
    emit(type: string, data: Record<string, unknown>, directory = "/repo") {
      // As on a real server, session.execution.* events carry no location; session.step.* events do.
      queue.push(type.startsWith("session.execution.") ? { type, data } : { type, data, location: { directory } })
      wake?.()
    },
    tool(event: Record<string, unknown>) {
      afterTool!({ agent: "build", messageID: "msg", status: "completed", result: {}, ...event })
    },
  }
}

const model = { id: "gpt-6.1-sol", providerID: "openai" }

async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

test("a run's steps form one turn, including edits made after a tool-calls step ends", async () => {
  const ide = await fakeIde()
  const opencode = fakeContext(ide.url)
  const cleanup = await plugin.setup(opencode.ctx as never)
  try {
    opencode.emit("session.step.started", { sessionID: "ses_1", agent: "build", model })
    opencode.emit("session.step.ended", { sessionID: "ses_1", finish: "tool-calls" })
    await until(() => ide.calls.length === 1, "turn begin")
    opencode.tool({ sessionID: "ses_1", tool: "edit", id: "call_1", input: { path: "src/a.ts", oldString: "a", newString: "b" } })
    opencode.tool({
      sessionID: "ses_1",
      tool: "patch",
      id: "call_2",
      input: { patchText: "*** Begin Patch\n*** Update File: /repo/b.ts\n*** Move to: /repo/c.ts\n*** Add File: d.ts\n+x\n*** End Patch" },
    })
    opencode.tool({ sessionID: "ses_1", tool: "shell", id: "call_3", input: { command: "ls" } })
    opencode.tool({ sessionID: "ses_1", tool: "read", id: "call_4", input: { path: "src/a.ts" } })
    opencode.emit("session.step.started", { sessionID: "ses_1", agent: "build", model })
    opencode.emit("session.step.ended", { sessionID: "ses_1", finish: "stop" })
    opencode.emit("session.execution.succeeded", { sessionID: "ses_1" })
    await until(() => ide.calls.length === 2, "turn end")

    const [begin, end] = ide.calls
    assert.equal(begin!.name, "review_turn_snapshot_begin")
    assert.deepEqual(
      { ...begin!.args, stepId: "<id>" },
      { sessionId: "ses_1", stepId: "<id>", projectPath: "/repo", agent: "build", model: "openai/gpt-6.1-sol" },
    )
    assert.equal(end!.name, "review_turn_snapshot_end")
    assert.equal(end!.args.stepId, begin!.args.stepId)
    assert.equal(end!.args.status, "completed")
    assert.deepEqual(JSON.parse(end!.args.changedPathsJson), ["/repo/src/a.ts", "/repo/b.ts", "/repo/c.ts", "/repo/d.ts"])
    assert.deepEqual(
      JSON.parse(end!.args.toolCallsJson).map((call: { callId: string; tool: string }) => `${call.tool}:${call.callId}`),
      ["edit:call_1", "patch:call_2", "shell:call_3"],
    )
  } finally {
    await cleanup?.()
    await ide.close()
  }
})

test("failed and interrupted runs end as failed; sessions are tracked separately", async () => {
  const ide = await fakeIde()
  const opencode = fakeContext(ide.url)
  const cleanup = await plugin.setup(opencode.ctx as never)
  try {
    for (const sessionID of ["ses_a", "ses_b", "ses_c"]) opencode.emit("session.step.started", { sessionID, agent: "build", model })
    opencode.emit("session.execution.failed", { sessionID: "ses_a", error: { type: "api", message: "boom" } })
    opencode.emit("session.execution.interrupted", { sessionID: "ses_b", reason: "user" })
    opencode.emit("session.execution.succeeded", { sessionID: "ses_c" })
    await until(() => ide.calls.length === 6, "three turns")
    const statuses = Object.fromEntries(
      ide.calls.filter((call) => call.name === "review_turn_snapshot_end").map((call) => [call.args.sessionId, call.args.status]),
    )
    assert.deepEqual(statuses, { ses_a: "failed", ses_b: "failed", ses_c: "completed" })
  } finally {
    await cleanup?.()
    await ide.close()
  }
})

test("sessions in other locations belong to their own plugin instance", async () => {
  const ide = await fakeIde()
  const opencode = fakeContext(ide.url)
  const cleanup = await plugin.setup(opencode.ctx as never)
  try {
    opencode.emit("session.step.started", { sessionID: "ses_other", agent: "build", model }, "/other-project")
    opencode.tool({ sessionID: "ses_other", tool: "write", id: "call_1", input: { path: "x", content: "" } })
    opencode.emit("session.execution.succeeded", { sessionID: "ses_other" }, "/other-project")
    opencode.emit("session.step.started", { sessionID: "ses_here", agent: "build", model })
    opencode.emit("session.execution.succeeded", { sessionID: "ses_here" })
    await until(() => ide.calls.length === 2, "this location's turn")
    await new Promise((done) => setTimeout(done, 50))
    assert.deepEqual(new Set(ide.calls.map((call) => call.args.sessionId)), new Set(["ses_here"]))
  } finally {
    await cleanup?.()
    await ide.close()
  }
})

test("an unreachable IDE never breaks the session", async () => {
  const opencode = fakeContext("http://127.0.0.1:9/stream")
  const cleanup = await plugin.setup(opencode.ctx as never)
  opencode.emit("session.step.started", { sessionID: "ses_x", agent: "build", model })
  opencode.tool({ sessionID: "ses_x", tool: "write", id: "call_1", input: { path: "a.txt", content: "x" } })
  opencode.emit("session.execution.succeeded", { sessionID: "ses_x" })
  await new Promise((done) => setTimeout(done, 50))
  await cleanup?.()
})

test("only completed built-in file tools report changed paths", () => {
  assert.deepEqual(changedPaths("write", { path: "/abs/x" }, "/repo"), ["/abs/x"])
  assert.deepEqual(changedPaths("edit", { path: "../y" }, "/repo/sub"), ["/repo/y"])
  assert.deepEqual(changedPaths("shell", { command: "rm x" }, "/repo"), [])
  assert.deepEqual(changedPaths("patch", { patchText: 42 }, "/repo"), [])
  assert.deepEqual(changedPaths("edit", null, "/repo"), [])
})
