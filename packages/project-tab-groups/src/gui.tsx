import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import {
  Command,
  Plugin,
  SettingsPage,
  Store,
  Style,
  usePlugin,
  type ServerRef,
  type SetupContext,
  type ShellTab,
} from "@opencode/plugin/gui"

const Prefs = Schema.Struct({
  autoSort: Schema.Boolean,
  decorate: Schema.Boolean,
  labels: Schema.Boolean,
})

type Prefs = typeof Prefs.Type

const definition = Plugin.define({
  stores: {
    prefs: Store.global(Prefs, { autoSort: true, decorate: true, labels: true }),
  },
  i18n: {
    en: {
      title: "Project tab groups",
      "command.group": "Tabs",
      "command.switch": "Switch tab by project…",
      "command.sort": "Group tabs by project now",
      "command.autoSort": "Toggle automatic tab grouping by project",
      "command.decorate": "Toggle project colors on tabs",
      "command.labels": "Toggle project labels on tabs",
      "switch.title": "Open tabs by project",
      "switch.placeholder": "Search tabs",
      "group.other": "Other",
      "tab.untitled": "Untitled session",
      "tab.draft": "New session",
      "settings.autoSort": "Keep tabs grouped by project",
      "settings.autoSort.description":
        "Moves each tab next to the other tabs of its project. Dragging a tab moves its whole group.",
      "settings.decorate": "Color tabs by project",
      "settings.decorate.description": "Adds a colored bar to each tab and a divider between project groups.",
      "settings.labels": "Show project labels",
      "settings.labels.description": "Shows the project name before each group of tabs.",
    },
  },
})

type Ctx = SetupContext<typeof definition>

interface Group {
  key: string
  label: string
  color: string
}

const PALETTE: Record<string, string> = {
  blue: "#3e8ef7",
  green: "#46a758",
  orange: "#f76b15",
  purple: "#9b6ef3",
  pink: "#e54d9e",
  cyan: "#12a5a0",
  yellow: "#e2b400",
  red: "#e5484d",
  gray: "#8b8d98",
}
const ROTATION = ["blue", "green", "orange", "purple", "pink", "cyan", "yellow", "red"]
const ALIASES: Record<string, string> = { mint: "cyan", lime: "green" }

const hash = (value: string) => {
  let h = 2166136261

  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619)

  return h >>> 0
}

const colorFor = (key: string, named?: string) => {
  const name = named ? (ALIASES[named] ?? named) : undefined

  return (name && PALETTE[name]) || PALETTE[ROTATION[hash(key) % ROTATION.length]]
}

const basename = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path

const cssString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`

// The app draws its own tab separators with the slot's ::before and hides them in places (vertical tabs, the active
// tab), so every declaration of ours on that pseudo-element must win over its rules.
const important = (declarations: Record<string, string>) =>
  `{${Object.entries(declarations)
    .map(([property, value]) => `${property}:${value}!important`)
    .join(";")}}`

const slot = (key: string) => `[data-titlebar-tab-slot][data-tab-key="${CSS.escape(key)}"]`

let measurer: CanvasRenderingContext2D | null | undefined

const labelWidth = (text: string) => {
  if (measurer === undefined) measurer = document.createElement("canvas").getContext("2d")
  const family = getComputedStyle(document.body).fontFamily || "system-ui"

  if (!measurer) return Math.min(120, text.length * 6.5)
  measurer.font = `600 11px ${family}`

  return Math.min(120, Math.ceil(measurer.measureText(text).width) + 2)
}

/** Strip order with every project's tabs moved together, groups in order of their first tab. */
const groupedOrder = (tabs: readonly ShellTab[], groupOf: (tab: ShellTab) => Group | undefined) => {
  const order: string[] = []
  const members = new Map<string, string[]>()

  tabs.forEach((tab) => {
    const id = groupOf(tab)?.key ?? `solo:${tab.key}`
    const list = members.get(id)

    if (list) return void list.push(tab.key)
    members.set(id, [tab.key])
    order.push(id)
  })

  return order.flatMap((id) => members.get(id) ?? [])
}

function createGroups(ctx: Ctx) {
  // Names the sidebar shows for projects (users can rename them locally), learned from routed sessions.
  const [names, setNames] = createSignal<Record<string, string>>({})
  const requested = new Set<string>()

  createEffect(() => {
    const session = ctx.sessions.current()
    const name = session?.listedProject?.name
    const project = session?.project?.id

    if (!session || !name || !project) return
    const key = `${session.server.id}\n${project}`

    if (untrack(names)[key] !== name) setNames((value) => ({ ...value, [key]: name }))
  })

  const projects = (server: ServerRef) => {
    try {
      return server.data.project.list()
    } catch {
      return []
    }
  }

  const loadProjects = (server: ServerRef) => {
    if (requested.has(server.id)) return
    requested.add(server.id)
    void server.data.project.sync().catch(() => requested.delete(server.id))
  }

  const info = (tab: ShellTab) => {
    const ref = tab.session

    if (!ref) return

    try {
      return ref.server.data.session.get(ref.id) ?? undefined
    } catch {
      return undefined
    }
  }

  // Projects on other servers can share a folder name with local ones (e.g. /Users/fatih and a devbox's /home/fatih),
  // so their labels name the server too.
  const withServer = (label: string, server: ServerRef) => {
    if (server.builtin) return label
    let name = server.name

    if (!name || name === server.id || name === server.url) {
      try {
        name = new URL(server.url || server.id).hostname
      } catch {
        name = server.id
      }
    }

    return `${label} · ${name}`
  }

  const groupOf = (tab: ShellTab): Group | undefined => {
    const ref = tab.session

    if (!ref) return
    const session = info(tab)
    const directory = session?.location.directory ?? ref.location?.directory
    const projectID = session?.projectID

    if (projectID && projectID !== "global") {
      const key = `${ref.server.id}\n${projectID}`
      const project = projects(ref.server).find((item) => item.id === projectID)

      if (!project) loadProjects(ref.server)
      const label =
        names()[key] ?? project?.name ?? (project ? basename(project.canonical) : directory ? basename(directory) : "")

      if (label) return { key, label: withServer(label, ref.server), color: colorFor(key, project?.icon?.color) }
    }

    if (!directory) return
    const key = `${ref.server.id}\ndir:${directory}`

    return { key, label: withServer(basename(directory), ref.server), color: colorFor(key) }
  }

  const title = (tab: ShellTab) => {
    if (!tab.session) return ctx.t("tab.draft")

    return info(tab)?.title?.trim() || ctx.t("tab.untitled")
  }

  return { groupOf, info, title }
}

function createAutoSort(ctx: Ctx, groupOf: (tab: ShellTab) => Group | undefined) {
  let timer: number | undefined

  const dragging = () => !!document.querySelector('[data-titlebar-tab][data-dragging="true"]')

  const sort = () => {
    const tabs = untrack(() => ctx.tabs.list())
    const current = tabs.map((tab) => tab.key)
    const target = untrack(() => groupedOrder(tabs, groupOf))

    target.forEach((key, index) => {
      if (current[index] === key) return
      ctx.tabs.move(key, index)
      current.splice(current.indexOf(key), 1)
      current.splice(index, 0, key)
    })
  }

  const schedule = (delay = 250) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (dragging()) return schedule(400)
      sort()
    }, delay)
  }

  createEffect(() => {
    if (!ctx.stores.prefs.value.autoSort) return
    // Re-run whenever the strip or any tab's project changes.
    ctx.tabs
      .list()
      .map((tab) => `${tab.key}=${groupOf(tab)?.key ?? ""}`)
      .join("|")
    schedule()
  })

  onCleanup(() => window.clearTimeout(timer))

  return sort
}

function createDecorations(ctx: Ctx, groupOf: (tab: ShellTab) => Group | undefined) {
  const css = createMemo(() => {
    const prefs = ctx.stores.prefs.value

    if (!prefs.decorate) return ""
    const rules: string[] = []
    const grouped: string[] = []
    const tabs = ctx.tabs.list()
    // Contiguous runs of one project's tabs; each run gets its own header.
    const runs: { group: Group; keys: string[]; index: number }[] = []

    tabs.forEach((tab, index) => {
      const group = groupOf(tab)

      if (!group) return
      const sel = slot(tab.key)
      const last = runs.at(-1)

      grouped.push(sel)
      rules.push(`${sel}{--ptg-color:${group.color}}`)

      if (last && last.group.key === group.key && last.index + last.keys.length === index) last.keys.push(tab.key)
      else runs.push({ group, keys: [tab.key], index })
    })

    runs.forEach(({ group, keys, index }) => {
      const sel = slot(keys[0])

      if (prefs.labels) {
        const width = labelWidth(group.label)

        rules.push(
          `${sel}[data-orientation="horizontal"]{margin-left:${width + (index === 0 ? 10 : 18)}px}`,
          `${sel}[data-orientation="horizontal"]::before${important({
            content: cssString(group.label),
            display: "block",
            position: "absolute",
            "inset-inline-start": "auto",
            right: "calc(100% + 6px)",
            left: "auto",
            top: "50%",
            bottom: "auto",
            transform: "translateY(-50%)",
            width: "auto",
            height: "auto",
            "max-width": `${width}px`,
            background: "none",
            "border-radius": "0",
            "font-size": "11px",
            "font-weight": "600",
            "line-height": "14px",
            color: "var(--ptg-color)",
            "white-space": "nowrap",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "pointer-events": "none",
          })}`,
          `${sel}[data-orientation="vertical"]{margin-top:${index === 0 ? 22 : 30}px}`,
          `${sel}[data-orientation="vertical"]::before${important({
            content: cssString(group.label),
            display: "block",
            position: "absolute",
            "inset-inline-start": "auto",
            left: "6px",
            right: "6px",
            top: "auto",
            bottom: "calc(100% + 4px)",
            transform: "none",
            width: "auto",
            height: "auto",
            "padding-inline-start": "8px",
            background: "none",
            "border-radius": "0",
            "border-inline-start": "2px solid var(--ptg-color)",
            "font-size": "11px",
            "font-weight": "600",
            "letter-spacing": ".04em",
            "text-transform": "uppercase",
            "line-height": "14px",
            color: "var(--ptg-color)",
            "white-space": "nowrap",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "pointer-events": "none",
          })}`,
        )

        return
      }

      if (index === 0) return
      rules.push(
        `${sel}[data-orientation="horizontal"]{margin-left:12px}`,
        `${sel}[data-orientation="horizontal"]::before${important({
          content: '""',
          display: "block",
          position: "absolute",
          "inset-inline-start": "auto",
          left: "-9px",
          right: "auto",
          top: "6px",
          bottom: "6px",
          width: "1px",
          height: "auto",
          background: "currentColor",
          opacity: ".25",
          "pointer-events": "none",
        })}`,
        `${sel}[data-orientation="vertical"]{margin-top:10px}`,
        `${sel}[data-orientation="vertical"]::before${important({
          content: '""',
          display: "block",
          position: "absolute",
          "inset-inline-start": "auto",
          left: "8px",
          right: "8px",
          top: "-7px",
          bottom: "auto",
          width: "auto",
          height: "1px",
          background: "currentColor",
          opacity: ".2",
          "pointer-events": "none",
        })}`,
      )
    })

    if (grouped.length === 0) return ""
    const all = `:is(${grouped.join(",")})`

    return [
      ...rules,
      `${all}[data-orientation="horizontal"]::after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px;background:var(--ptg-color);opacity:.85;pointer-events:none;z-index:1}`,
      `${all}[data-orientation="vertical"]::after{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:2px;background:var(--ptg-color);opacity:.85;pointer-events:none;z-index:1}`,
    ].join("\n")
  })

  ctx.add(Style, () => css() || undefined)
}

function SettingsView() {
  const ctx = usePlugin<typeof definition>()
  const prefs = ctx.stores.prefs
  const row = (key: keyof Prefs) => (
    <ctx.ui.Switch
      checked={prefs.value[key]}
      onChange={(checked) => prefs.update((draft) => void (draft[key] = checked))}
      label={ctx.t(`settings.${key}`)}
      description={ctx.t(`settings.${key}.description`)}
    />
  )

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {row("autoSort")}
      {row("decorate")}
      {row("labels")}
    </div>
  )
}

export default Plugin.define({
  ...definition,
  setup(ctx) {
    const { groupOf, title } = createGroups(ctx)
    const sort = createAutoSort(ctx, groupOf)

    createDecorations(ctx, groupOf)

    const toggle = (key: keyof Prefs) => ctx.stores.prefs.update((draft) => void (draft[key] = !draft[key]))

    const openSwitcher = async () => {
      const tabs = ctx.tabs.list()
      const byKey = new Map(tabs.map((tab) => [tab.key, tab]))
      const ordered = groupedOrder(tabs, groupOf)
        .map((key) => byKey.get(key))
        .filter((tab): tab is ShellTab => !!tab)
      const key = await ctx.dialogs.select({
        title: ctx.t("switch.title"),
        placeholder: ctx.t("switch.placeholder"),
        current: tabs.find((tab) => tab.active)?.key,
        options: ordered.map((tab) => {
          const directory = tab.session?.location?.directory

          return {
            title: title(tab),
            description: directory,
            value: tab.key,
            group: groupOf(tab)?.label ?? ctx.t("group.other"),
          }
        }),
      })

      if (key) ctx.tabs.focus(key)
    }

    ctx.add(
      Command,
      (): Command => ({
        id: "switch",
        title: ctx.t("command.switch"),
        group: ctx.t("command.group"),
        keywords: "project tabs group switch",
        section: "navigation",
        featured: true,
        run: () => void openSwitcher(),
      }),
    )
    ctx.add(Command, () => ({
      id: "sort",
      title: ctx.t("command.sort"),
      group: ctx.t("command.group"),
      keywords: "project tabs group sort order",
      run: sort,
    }))
    ctx.add(Command, () => ({
      id: "toggle-auto-sort",
      title: ctx.t("command.autoSort"),
      group: ctx.t("command.group"),
      keywords: "project tabs group sort",
      run: () => toggle("autoSort"),
    }))
    ctx.add(Command, () => ({
      id: "toggle-decorate",
      title: ctx.t("command.decorate"),
      group: ctx.t("command.group"),
      keywords: "project tabs color",
      run: () => toggle("decorate"),
    }))
    ctx.add(Command, () => ({
      id: "toggle-labels",
      title: ctx.t("command.labels"),
      group: ctx.t("command.group"),
      keywords: "project tabs label name",
      run: () => toggle("labels"),
    }))

    ctx.add(SettingsPage, {
      id: "project-tab-groups",
      icon: "folder",
      get title() {
        return ctx.t("title")
      },
      get entries() {
        return (["autoSort", "decorate", "labels"] as const).map((key) => ({
          id: key,
          title: ctx.t(`settings.${key}`),
          description: ctx.t(`settings.${key}.description`),
          keywords: "project tabs group",
        }))
      },
      render: () => <SettingsView />,
    })
  },
})
