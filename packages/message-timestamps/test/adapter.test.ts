import assert from "node:assert/strict"
import test from "node:test"
import { createAdapter, createFormatter, formatTimestamp, plainText, type Message } from "../src/adapter.ts"

class Node {
  [key: string]: any
  children: any[] = []
  constructor(options: Record<string, unknown> = {}) {
    Object.assign(this, options)
  }
  add(child: any) {
    this.children.push(child)
    if (typeof child !== "string") child.parent = this
  }
  replace(child: any, index: number) {
    this.children[index] = child
  }
  remove(child: any) {
    this.children.splice(this.children.indexOf(child), 1)
    child.parent = null
  }
  getChildren() {
    return this.children.filter((child) => typeof child !== "string")
  }
  destroy() {
    this.isDestroyed = true
  }
}
function box(...children: unknown[]) {
  const node = new Node()
  children.forEach((child) => node.add(child))
  return node
}
function span(value: string) {
  return box(value)
}
function text(...values: string[]) {
  const node = box(...values.map(span))
  node.getTextChildren = node.getChildren
  return node
}

const istanbul = createFormatter("Europe/Istanbul")

function fixture() {
  const message: Message = {
    id: "msg_a",
    type: "assistant",
    agent: "build",
    finish: "stop",
    time: { created: Date.parse("2026-11-04T10:00:00Z"), completed: Date.parse("2026-11-04T10:14:44Z") },
  }
  const anchor = box()
  anchor.id = message.id
  const footer = text("Build", " · Claude Opus 5.5", " · 14m 44s", " · 27.4 tok/s")
  const row = box(box(footer))
  const scroll = box(anchor, row)
  scroll.scrollBy = () => {}
  const root = box(scroll)
  const adapter = createAdapter({
    makeNode: (options) => new Node(options) as any,
    getColor: () => "muted",
    format: (time) => formatTimestamp(time, istanbul),
  })
  return { message, footer, anchor, row, scroll, root, adapter }
}

test("formats in the given time zone and labels it, across daylight saving changes", () => {
  assert.equal(formatTimestamp(Date.parse("2026-11-04T10:14:44Z"), istanbul), "04 Nov 2026, 13:14:44 GMT+3")
  assert.equal(formatTimestamp(Date.parse("2026-12-31T21:00:00Z"), istanbul), "01 Jan 2027, 00:00:00 GMT+3")
  const london = createFormatter("Europe/London")
  assert.equal(formatTimestamp(Date.parse("2026-11-04T10:14:44Z"), london), "04 Nov 2026, 10:14:44 GMT")
  assert.equal(formatTimestamp(Date.parse("2026-07-04T10:14:44Z"), london), "04 Jul 2026, 11:14:44 BST")
  const newYork = createFormatter("America/New_York")
  assert.equal(formatTimestamp(Date.parse("2026-11-04T10:14:44Z"), newYork), "04 Nov 2026, 05:14:44 GMT-5")
})

test("uses the computer's time zone by default", () => {
  const local = createFormatter(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const time = Date.parse("2026-11-04T10:14:44Z")
  assert.equal(formatTimestamp(time), formatTimestamp(time, local))
})

test("invalid dates are skipped, and Unix epoch is valid", () => {
  for (const value of [undefined, null, NaN, Infinity, "123", 1e30]) assert.equal(formatTimestamp(value), undefined)
  assert.ok(formatTimestamp(0))
})

test("appends once without replacing agent/model/duration/TPS spans", () => {
  const f = fixture()
  const original = [...f.footer.children]
  for (let i = 0; i < 5; i++) f.adapter.update(f.root, [f.message])
  assert.equal(f.footer.children.length, original.length + 1)
  assert.deepEqual(f.footer.children.slice(0, -1), original)
  assert.equal(plainText(f.footer), "Build · Claude Opus 5.5 · 14m 44s · 27.4 tok/s · 04 Nov 2026, 13:14:44 GMT+3")
  f.adapter.dispose()
  assert.deepEqual(f.footer.children, original)
})

test("supports session-part anchors and TPS hidden", () => {
  const f = fixture()
  f.anchor.id = "session-part:msg_a:text:0"
  f.footer.remove(f.footer.children.at(-1))
  f.adapter.update(f.root, [f.message])
  assert.ok(plainText(f.footer).endsWith("13:14:44 GMT+3"))
})

test("creation fallback updates to saved completion time", () => {
  const f = fixture()
  delete f.message.time!.completed
  f.adapter.update(f.root, [f.message])
  assert.ok(plainText(f.footer).endsWith("13:00:00 GMT+3"))
  f.message.time!.completed = Date.parse("2026-11-04T10:14:44Z")
  f.adapter.update(f.root, [f.message])
  assert.ok(plainText(f.footer).endsWith("13:14:44 GMT+3"))
  assert.equal(f.footer.children.length, 5)
})

test("never decorates message bodies, tool-only steps or unrelated rows", () => {
  const f = fixture()
  f.message.finish = "tool-calls"
  f.adapter.update(f.root, [f.message])
  assert.equal(f.footer.children.length, 4)
  f.message.finish = "stop"
  f.footer.children[0].replace("This is message body text", 0)
  f.adapter.update(f.root, [f.message])
  assert.equal(f.footer.children.length, 4)
})

test("session switch and virtualized row removal clean decorations", () => {
  const f = fixture()
  f.adapter.update(f.root, [f.message])
  const decoration = f.footer.children.at(-1)
  f.adapter.update(f.root, [])
  assert.equal(f.footer.children.length, 4)
  assert.equal(decoration.isDestroyed, true)
  f.adapter.update(f.root, [f.message])
  f.scroll.remove(f.row)
  f.adapter.update(f.root, [f.message])
  assert.equal(f.footer.children.length, 4)
})

test("destroyed host text is not accessed during cleanup", () => {
  const f = fixture()
  f.adapter.update(f.root, [f.message])
  f.footer.isDestroyed = true
  f.footer.remove = () => {
    throw Error("destroyed host accessed")
  }
  assert.doesNotThrow(() => f.adapter.dispose())
})
