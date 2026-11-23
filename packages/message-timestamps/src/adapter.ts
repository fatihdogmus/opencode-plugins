/** The parts of an assistant message the footer timestamp needs. */
export type Message = {
  id: string
  type?: string
  agent?: string
  finish?: string
  error?: unknown
  retry?: unknown
  time?: { created?: number; completed?: number }
}

/** The OpenTUI renderable methods the adapter relies on. */
export type Renderable = {
  id?: string
  isDestroyed?: boolean
  visible?: boolean
  children?: unknown[]
  parent?: unknown
  scrollBy?: unknown
  getChildren?(): Renderable[]
  getTextChildren?(): unknown[]
  add(child: unknown): unknown
  remove(child: unknown): unknown
}

export type TextNode = {
  parent?: unknown
  fg?: unknown
  add(text: string): unknown
  replace(text: string, index: number): unknown
  destroy(): void
}

export type AdapterOptions<Color> = {
  makeNode: (options: { id: string; fg: Color }) => TextNode
  getColor: () => Color
  /** Formats a message time; defaults to the computer's time zone. */
  format?: (time: unknown) => string | undefined
}

/** A formatter for the given IANA time zone, or for the computer's time zone when none is given. */
export function createFormatter(timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
}

const localFormatter = createFormatter()

/** `04 Nov 2026, 13:14:44`, or undefined for anything that isn't a valid time. */
export function formatTimestamp(time: unknown, formatter: Intl.DateTimeFormat = localFormatter) {
  if (typeof time !== "number" || !Number.isFinite(time)) return undefined
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return undefined
  return formatter.format(date)
}

// Do not use toChunks() to read host nodes: it clears their dirty state.
export function plainText(node: unknown): string {
  if (typeof node === "string") return node
  const children = (node as { children?: unknown[] } | undefined)?.children ?? []
  return children.map(plainText).join("")
}

function messageID(row: Renderable, messages: Map<string, Message>) {
  if (row.id && messages.has(row.id)) return row.id
  const match = /^session-part:([^:]+):/.exec(row.id ?? "")
  return match && messages.has(match[1]!) ? match[1] : undefined
}

function agentLabel(agent: string | undefined) {
  return agent ? agent[0]!.toUpperCase() + agent.slice(1) : ""
}

// OpenCode has no public assistant-footer slot. This is the ONLY host-layout-dependent part:
// transcript row -> footer box -> text -> spans. Unrecognized layouts are skipped rather than
// modifying message bodies.
function footerText(row: Renderable, message: Message | undefined) {
  if (message?.type !== "assistant") return undefined
  if (!message.finish && !message.error && !message.retry) return undefined
  if (["tool-calls", "unknown"].includes(message.finish ?? "") && !message.error && !message.retry) return undefined
  for (const box of row.getChildren?.() ?? []) {
    const children = box.getChildren?.() ?? []
    if (children.length !== 1) continue
    const text = children[0]!
    const spans = text.getTextChildren?.()
    if (!spans?.length || plainText(spans[0]) !== agentLabel(message.agent)) continue
    if (
      !spans.slice(1).every((span) => {
        const value = plainText(span)
        return value === "" || value.startsWith(" · ")
      })
    )
      continue
    return text
  }
}

type Decoration<Color> = { node: TextNode; suffix: string; color: Color }

export function createAdapter<Color>({ makeNode, getColor, format = formatTimestamp }: AdapterOptions<Color>) {
  const decorations = new Map<Renderable, Decoration<Color>>()

  function remove(text: Renderable, decoration: Decoration<Color>) {
    if (!text.isDestroyed && decoration.node.parent) text.remove(decoration.node)
    decoration.node.destroy()
    decorations.delete(text)
  }

  function update(root: Renderable, list: readonly Message[]) {
    const messages = new Map(list.map((message) => [message.id, message]))
    const seen = new Set<Renderable>()

    function decorate(rows: Renderable[]) {
      let current: Message | undefined
      for (const row of rows) {
        const id = messageID(row, messages)
        if (id) current = messages.get(id)
        const text = footerText(row, current)
        if (!text || !current) continue
        const timestamp = format(current.time?.completed ?? current.time?.created)
        if (!timestamp) continue
        seen.add(text)
        const suffix = ` · ${timestamp}`
        const color = getColor()
        const decoration = decorations.get(text)
        if (!decoration) {
          const node = makeNode({ id: `message-timestamp:${current.id}`, fg: color })
          node.add(suffix)
          text.add(node)
          decorations.set(text, { node, suffix, color })
          continue
        }
        if (decoration.suffix !== suffix) {
          decoration.node.replace(suffix, 0)
          decoration.suffix = suffix
        }
        if (decoration.color !== color) {
          decoration.node.fg = color
          decoration.color = color
        }
      }
    }

    function walk(node: Renderable) {
      if (node.isDestroyed || node.visible === false) return
      const children = node.getChildren?.() ?? []
      // Only transcript scrollboxes have direct rows keyed by message IDs.
      if (typeof node.scrollBy === "function" && children.some((row) => messageID(row, messages))) {
        decorate(children)
        return
      }
      if (typeof node.getTextChildren === "function") return
      for (const child of children) walk(child)
    }

    walk(root)
    for (const [text, decoration] of decorations) {
      if (!seen.has(text)) remove(text, decoration)
    }
  }

  return {
    update,
    dispose() {
      for (const [text, decoration] of decorations) remove(text, decoration)
    },
  }
}
