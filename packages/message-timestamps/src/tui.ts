import { Plugin } from "@opencode/plugin/tui"
import { TextNodeRenderable } from "@opentui/core"
import { createAdapter, type Message, type Renderable } from "./adapter.ts"

export default Plugin.define({
  id: "message-timestamps.tui",
  setup(context) {
    const adapter = createAdapter({
      makeNode: (options) => new TextNodeRenderable(options),
      getColor: () => context.theme.text.muted,
    })
    let failed = false
    const update = async () => {
      if (failed) return
      try {
        const route = context.ui.router.current()
        const messages = route.type === "session" ? (context.data.session.message.list(route.sessionID) ?? []) : []
        adapter.update(context.renderer.root as unknown as Renderable, messages as unknown as Message[])
      } catch (error) {
        failed = true
        adapter.dispose()
        context.ui.toast.show({
          title: "Message timestamps disabled",
          message: "The TUI layout may have changed. See the message-timestamps plugin README.",
          variant: "warning",
        })
        console.error("Message timestamps:", error)
      }
    }
    context.renderer.setFrameCallback(update)
    context.renderer.requestRender()
    return () => {
      context.renderer.removeFrameCallback(update)
      adapter.dispose()
    }
  },
})
