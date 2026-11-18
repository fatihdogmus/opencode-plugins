import { test } from "node:test"
import assert from "node:assert/strict"
import { isUnavailable, whenAvailable } from "../src/rpc.ts"

const unavailable = { type: "rpc.unavailable", message: "RPC is unavailable: voice-input" }

test("a call made while the RPC is still being registered is retried until it is available", async () => {
  const waits: number[] = []
  let calls = 0
  const result = await whenAvailable(
    async () => {
      calls++
      if (calls < 3) throw unavailable
      return { text: "hello" }
    },
    async (ms) => void waits.push(ms),
  )
  assert.deepEqual(result, { text: "hello" })
  assert.equal(calls, 3)
  assert.deepEqual(waits, [250, 500])
})

test("other errors are not retried", async () => {
  let calls = 0
  const upstream = { type: "upstream", message: "HTTP 500", data: { message: "Transcription failed" } }
  await assert.rejects(
    whenAvailable(async () => {
      calls++
      throw upstream
    }, async () => {}),
    (error) => error === upstream,
  )
  assert.equal(calls, 1)
})

test("retrying gives up after about 8 seconds and reports that the RPC is unavailable", async () => {
  const waits: number[] = []
  let calls = 0
  await assert.rejects(
    whenAvailable(async () => {
      calls++
      throw unavailable
    }, async (ms) => void waits.push(ms)),
    (error) => isUnavailable(error),
  )
  assert.equal(calls, 7)
  assert.equal(waits.reduce((sum, ms) => sum + ms, 0), 7750)
})
