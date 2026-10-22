import { motionTuning } from "@opencode/ui/motion-tuning"
import { Button } from "@opencode/ui/button"
import { createEffect, onCleanup, onMount, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import en from "@/runtime/i18n/en"
import { useVoice } from "./context"
import "./voice.css"

const toggle = motionTuning.toggle("voice.calls", {
  label: en["experiment.voiceCalls"],
  group: "Experiments",
  card: "Experiments",
  value: false,
})

export function VoiceComposer(props: ParentProps<{ session: SessionInfo | undefined }>) {
  const voice = useVoice()
  const server = useServer()
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({ enabled: toggle() })
  onMount(() => onCleanup(voice.mountComposer()))
  onCleanup(motionTuning.subscribe(() => setState("enabled", toggle())))
  const enabled = () =>
    platform.platform === "desktop" && import.meta.env.VITE_OPENCODE_CHANNEL !== "prod" && state.enabled
  const active = () => voice.state.status !== "idle"
  createEffect(() => {
    const session = props.session

    if (session && voice.state.server === server.key) voice.view(server.key, session)
  })

  return (
    <Show
      when={active()}
      fallback={
        <>
          {props.children}
          <Show when={enabled() && props.session}>
            <div class="voice-call-action">
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  const session = props.session

                  if (session) void voice.start(server.key, server.ctx, session)
                }}
              >
                {language.t("voice.call")}
              </Button>
            </div>
          </Show>
        </>
      }
    >
      <VoiceCapsule />
    </Show>
  )
}

export function VoiceOverlay() {
  const voice = useVoice()

  return (
    <Show when={voice.state.status !== "idle" && !voice.state.composers}>
      <div class="voice-overlay">
        <VoiceCapsule />
      </div>
    </Show>
  )
}

function VoiceCapsule() {
  const voice = useVoice()
  const language = useLanguage()

  return (
    <section class="voice-capsule" aria-label={language.t("voice.call")}>
      <div class="voice-controls">
        <Button
          size="small"
          variant="ghost"
          disabled={voice.state.status !== "connected"}
          aria-pressed={voice.state.muted}
          onClick={voice.mute}
        >
          {language.t(voice.state.muted ? "voice.unmute" : "voice.mute")}
        </Button>
        <meter class="voice-level" min={0} max={1} value={voice.state.level} aria-label={language.t("voice.level")} />
        <span class="voice-title">{voice.state.title}</span>
        <Show when={voice.state.status === "dropped"}>
          <Button size="small" variant="outline" onClick={() => void voice.rejoin()}>
            {language.t("voice.rejoin")}
          </Button>
        </Show>
        <Button size="small" variant="ghost" onClick={() => void voice.end()}>
          {language.t("voice.end")}
        </Button>
      </div>
      <Show when={voice.state.status === "connecting"}>
        <p role="status">{language.t("voice.connecting")}</p>
      </Show>
      <Show when={voice.state.status === "dropped"}>
        <p role="alert">{language.t(`voice.failure.${voice.state.failure ?? "dropped"}`)}</p>
      </Show>
      <Show when={voice.state.caption}>
        <p class="voice-caption">
          <span>{language.t(voice.state.speaker === "user" ? "voice.you" : "voice.assistant")}</span>{" "}
          {voice.state.caption}
        </p>
      </Show>
    </section>
  )
}
