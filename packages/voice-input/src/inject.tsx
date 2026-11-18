import { createEffect, createSignal, Match, Switch, type Accessor } from "solid-js"
import { render } from "solid-js/web"

// Internal DOM of OpenCode Desktop's composer (app/src/composer/editor/editor.tsx), not plugin API:
//   <form data-component="composer"> … <div class="flex h-11 …">           ← static row
//     <div>＋ menu</div> <div data-slot="composer-controls"/> <div data-slot="composer-actions"/>  ← send button
// The mic goes into the static row right before composer-actions, so Solid never reconciles over it.
const ACTIONS = '[data-component="composer"] [data-slot="composer-actions"]'
const HOST = "data-voice-input"

export type ButtonPhase = "idle" | "starting" | "recording" | "transcribing"

export interface ButtonModel {
  phase: Accessor<ButtonPhase>
  owner: Accessor<HTMLElement | undefined>
  elapsed: Accessor<string>
  title: Accessor<string>
  onClick(host: HTMLElement): void
}

export const CSS = `
[${HOST}] { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-inline-end: 6px; }
[${HOST}] > button[data-component="icon-button-v2"] { width: 28px; height: 28px; border-radius: 6px; }
[${HOST}] > button svg { width: 16px; height: 16px; display: block; }
[${HOST}][data-phase="recording"] > button { color: var(--v2-state-fg-danger); background-color: color-mix(in srgb, var(--v2-state-fg-danger) 14%, transparent); }
[${HOST}][data-phase="recording"] > button:hover { background-color: color-mix(in srgb, var(--v2-state-fg-danger) 22%, transparent); }
[${HOST}][data-phase="transcribing"] > button svg, [${HOST}][data-phase="starting"] > button svg { animation: voice-input-spin .9s linear infinite; }
[${HOST}] [data-slot="voice-input-time"] { font-size: 11px; font-weight: 530; font-variant-numeric: tabular-nums; color: var(--v2-state-fg-danger); }
[${HOST}][data-phase="recording"] [data-slot="voice-input-dot"] { width: 6px; height: 6px; border-radius: 9999px; background: var(--v2-state-fg-danger); animation: voice-input-pulse 1.2s ease-in-out infinite; }
@keyframes voice-input-spin { to { transform: rotate(360deg); } }
@keyframes voice-input-pulse { 50% { opacity: .25; } }
:root[data-motion="reduce"] [${HOST}] * { animation: none !important; }
`

const MicIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" stroke="currentColor" />
    <path d="M3 7.75a5 5 0 0 0 10 0M8 12.75v1.75M5.75 14.5h4.5" stroke="currentColor" stroke-linecap="round" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
  </svg>
)

const SpinnerIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5" />
    <path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
)

function MicButton(props: { host: HTMLElement; model: ButtonModel }) {
  // Only the composer that started a recording shows its progress; the others stay a plain, disabled mic.
  const phase = () => {
    const current = props.model.phase()
    const owner = props.model.owner()
    return current === "idle" || !owner || owner === props.host ? current : "busy"
  }

  createEffect(() => {
    props.host.dataset.phase = phase() === "busy" ? "idle" : phase()
  })

  return (
    <>
      <Switch>
        <Match when={phase() === "recording"}>
          <span data-slot="voice-input-dot" />
          <span data-slot="voice-input-time">{props.model.elapsed()}</span>
        </Match>
      </Switch>
      <button
        type="button"
        data-component="icon-button-v2"
        data-size="normal"
        data-variant="ghost-muted"
        title={props.model.title()}
        aria-label={props.model.title()}
        aria-pressed={phase() === "recording"}
        disabled={phase() === "busy" || phase() === "transcribing" || phase() === "starting"}
        // Keep focus and the caret in the prompt, as the composer's own controls do.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.model.onClick(props.host)
        }}
      >
        <Switch fallback={<MicIcon />}>
          <Match when={phase() === "recording"}>
            <StopIcon />
          </Match>
          <Match when={phase() === "transcribing" || phase() === "starting"}>
            <SpinnerIcon />
          </Match>
        </Switch>
      </button>
    </>
  )
}

/** Keeps a mic button before the send button of every composer in the window. Returns how many are mounted. */
export function injectComposerButtons(model: ButtonModel) {
  const mounted = new Map<HTMLElement, () => void>()
  const [count, setCount] = createSignal(0)
  let frame = 0

  const scan = () => {
    frame = 0
    for (const actions of document.querySelectorAll<HTMLElement>(ACTIONS)) {
      const row = actions.parentElement
      if (!row || row.querySelector(`:scope > [${HOST}]`)) continue
      const host = document.createElement("div")
      host.setAttribute(HOST, "")
      row.insertBefore(host, actions)
      mounted.set(
        host,
        render(() => <MicButton host={host} model={model} />, host),
      )
    }
    for (const [host, dispose] of mounted) {
      if (host.isConnected) continue
      dispose()
      mounted.delete(host)
    }
    setCount(mounted.size)
  }

  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(scan)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  scan()

  return {
    count,
    dispose() {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      for (const [host, dispose] of mounted) {
        dispose()
        host.remove()
      }
      mounted.clear()
    },
  }
}

/** The composer element a mic host, or failing that the focused or first visible composer, belongs to. */
export function composerOf(host: HTMLElement | undefined) {
  const from = host?.closest<HTMLElement>('[data-component="composer"]')
  if (from?.isConnected) return from
  const focused = document.activeElement?.closest<HTMLElement>('[data-component="composer"]')
  if (focused) return focused
  return [...document.querySelectorAll<HTMLElement>('[data-component="composer"]')].find((el) => el.offsetParent)
}

/** Types text into a composer's editor through the browser's own input path, for composers the plugin API can't reach. */
export function typeInto(composer: HTMLElement, text: string) {
  const editor = composer.querySelector<HTMLElement>('[data-component="composer-editor"]')
  if (!editor) return false
  editor.focus()
  return document.execCommand("insertText", false, text)
}
