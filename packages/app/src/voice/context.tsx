import { createSimpleContext } from "@opencode/ui/context"
import { useNavigate } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { usePlatform } from "@/runtime/platform/platform"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import type { CallState, createVoiceCall } from "./call"

export const { provider: VoiceProvider, use: useVoice } = createSimpleContext({
  name: "Voice",
  init: () => {
    const platform = usePlatform()
    const navigate = useNavigate()

    const [state, setState] = createStore<CallState & { server?: ServerConnection.Key; composers: number }>({
      status: "idle",
      muted: false,
      level: 0,
      caption: "",
      speaker: "assistant",
      title: "",
      composers: 0,
    })

    const current: { call?: ReturnType<typeof createVoiceCall>; generation: number } = { generation: 0 }

    const end = async () => {
      const generation = ++current.generation
      const call = current.call
      current.call = undefined
      await call?.end()

      if (current.generation === generation)
        setState({ status: "idle", server: undefined, caption: "", level: 0, muted: false })
    }

    const unload = () => {
      void end()
    }

    window.addEventListener("pagehide", unload)
    window.addEventListener("beforeunload", unload)
    onCleanup(() => {
      window.removeEventListener("pagehide", unload)
      window.removeEventListener("beforeunload", unload)
      void end()
    })

    return {
      state,
      end,
      mountComposer() {
        setState("composers", (count) => count + 1)

        return () => setState("composers", (count) => count - 1)
      },
      mute: () => current.call?.mute(),
      rejoin: () => current.call?.join(),
      view(server: ServerConnection.Key, session: SessionInfo) {
        if (state.server === server) current.call?.view(session)
      },
      async start(server: ServerConnection.Key, ctx: ServerCtx, session: SessionInfo) {
        if (state.status !== "idle") return
        const generation = ++current.generation
        setState({ status: "connecting", server, title: session.title ?? session.id, failure: undefined })
        await import("./call")
          .then(async ({ createVoiceCall }) => {
            if (current.generation !== generation) return
            current.call = createVoiceCall({
              ctx,
              session,
              platform,
              open: (next) => navigate(sessionHref(server, next.id)),
              change: (change) => {
                if (current.generation === generation) setState(change)
              },
            })
            await current.call.join()
          })
          .catch(() => {
            if (current.generation === generation) setState({ status: "dropped", failure: "connection" })
          })
      },
    }
  },
})
