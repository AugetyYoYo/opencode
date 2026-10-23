import { For, Match, Show, Switch as Branch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import type { FormAnswer, FormInfo, FormValue, LocationRef } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import "./session-elicitation-dock.css"

type Field = FormInfo["fields"][number]

export function SessionElicitationDock(props: {
  request: FormInfo & { location?: LocationRef }
  onSubmit: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const data = useData()
  const fields = createMemo(() => props.request.fields.filter((field) => !("hidden" in field && field.hidden)))
  const message = () => {
    const value = props.request.metadata?.message
    return typeof value === "string" ? value : undefined
  }
  const [values, setValues] = createStore<Record<string, FormValue | undefined>>(
    Object.fromEntries(props.request.fields.map((field) => [field.key, initial(field)])),
  )
  // Number inputs keep their raw text so a half-typed value such as "-" is not discarded.
  const [numbers, setNumbers] = createStore<Record<string, string>>(
    Object.fromEntries(
      props.request.fields.flatMap((field) =>
        (field.type === "number" || field.type === "integer") && typeof field.default === "number"
          ? [[field.key, String(field.default)]]
          : [],
      ),
    ),
  )

  const fail = (error: Error) =>
    showToast({ title: language.t("common.requestFailed"), description: error.message })
  const input = () => ({ sessionID: props.request.sessionID, formID: props.request.id })
  const reply = useMutation(() => ({
    mutationFn: (answer: FormAnswer) => data.session.form.reply({ ...input(), answer }, props.request.location),
    onMutate: props.onSubmit,
    onError: fail,
  }))
  const cancel = useMutation(() => ({
    mutationFn: () => data.session.form.cancel(input(), props.request.location),
    onMutate: props.onSubmit,
    onError: fail,
  }))
  const sending = () => reply.isPending || cancel.isPending

  const submit = () => {
    if (sending()) return
    reply.mutate(
      Object.fromEntries(
        fields().flatMap((field): Array<[string, FormValue]> => {
          if (field.type === "external") return [[field.key, true]]
          if (field.type === "number" || field.type === "integer") {
            const text = numbers[field.key]?.trim()
            return text ? [[field.key, Number(text)]] : []
          }
          const value = values[field.key]
          if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return []
          return [[field.key, value]]
        }),
      ),
    )
  }

  return (
    <div data-component="session-elicitation-dock">
      <DockPrompt
        kind="question"
        onKeyDown={(event) => {
          if (event.defaultPrevented) return
          if (event.key === "Escape") {
            event.preventDefault()
            if (!sending()) cancel.mutate()
            return
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey) {
            event.preventDefault()
            submit()
          }
        }}
        header={
          <>
            <div data-slot="question-header-top">
              <div data-slot="question-header-title">
                <bdi>{props.request.title}</bdi>
              </div>
            </div>
            <Show when={message()}>
              {(text) => (
                <div data-slot="question-details">
                  <div data-slot="question-text">
                    <bdi>{text()}</bdi>
                  </div>
                </div>
              )}
            </Show>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={sending()} onClick={() => cancel.mutate()}>
              {language.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions">
              <Button variant="submit" size="large" disabled={sending()} onClick={submit}>
                {language.t("ui.common.submit")}
              </Button>
            </div>
          </>
        }
      >
        <div data-slot="elicitation-fields">
          <For each={fields()}>
            {(field) => (
              <div data-slot="elicitation-field">
                <Branch>
                  <Match when={field.type === "boolean" && field}>
                    <Label field={field} />
                    <Switch
                      hideLabel
                      checked={values[field.key] === true}
                      onChange={(checked) => setValues(field.key, checked)}
                      disabled={sending()}
                    >
                      {field.title ?? field.key}
                    </Switch>
                  </Match>
                  <Match when={(field.type === "number" || field.type === "integer") && field}>
                    <Label field={field} />
                    <TextInput
                      type="number"
                      numeric
                      step={field.type === "integer" ? 1 : "any"}
                      value={numbers[field.key] ?? ""}
                      disabled={sending()}
                      aria-label={field.title ?? field.key}
                      onInput={(event) => setNumbers(field.key, event.currentTarget.value)}
                    />
                  </Match>
                  <Match when={field.type === "string" && field.options?.length ? field : undefined}>
                    {(select) => (
                      <>
                        <Label field={select()} />
                        <Select
                          aria-label={select().title ?? select().key}
                          options={select().options ?? []}
                          current={select().options?.find((option) => option.value === values[select().key])}
                          value={(option) => option.value}
                          label={(option) => option.label}
                          onSelect={(option) => setValues(select().key, option?.value)}
                          placeholder={language.t("session.elicitation.selectPlaceholder")}
                          disabled={sending()}
                        />
                      </>
                    )}
                  </Match>
                  <Match when={field.type === "string" && field}>
                    {(text) => (
                      <>
                        <Label field={text()} />
                        <TextInput
                          type={text().format === "email" ? "email" : text().format === "uri" ? "url" : "text"}
                          value={textValue(values[text().key])}
                          placeholder={text().placeholder}
                          disabled={sending()}
                          aria-label={text().title ?? text().key}
                          onInput={(event) => setValues(text().key, event.currentTarget.value)}
                        />
                      </>
                    )}
                  </Match>
                  <Match when={field.type === "multiselect" && field}>
                    {(multi) => (
                      <>
                        <Label field={multi()} />
                        <For each={multi().options}>
                          {(option) => (
                            <Checkbox
                              checked={selected(values[multi().key]).includes(option.value)}
                              disabled={sending()}
                              onChange={(checked) =>
                                setValues(multi().key, (current) =>
                                  checked
                                    ? [...selected(current), option.value]
                                    : selected(current).filter((value) => value !== option.value),
                                )
                              }
                            >
                              {option.label}
                            </Checkbox>
                          )}
                        </For>
                      </>
                    )}
                  </Match>
                  <Match when={field.type === "external" && field}>
                    {(external) => (
                      <>
                        <Label field={external()} />
                        <div data-slot="elicitation-external">
                          <span data-slot="elicitation-url">{external().url}</span>
                          <Button
                            variant="neutral"
                            size="small"
                            disabled={sending()}
                            onClick={() => platform.openExternal(external().url)}
                          >
                            {language.t("common.open")}
                          </Button>
                        </div>
                      </>
                    )}
                  </Match>
                </Branch>
              </div>
            )}
          </For>
        </div>
      </DockPrompt>
    </div>
  )
}

function Label(props: { field: Field }) {
  return (
    <Show when={props.field.title || props.field.description}>
      <div data-slot="elicitation-label">
        <Show when={props.field.title}>
          <span data-slot="elicitation-title">{props.field.title}</span>
        </Show>
        <Show when={props.field.description}>
          <span data-slot="elicitation-description">{props.field.description}</span>
        </Show>
      </div>
    </Show>
  )
}

function initial(field: Field): FormValue | undefined {
  if (field.type === "boolean") return field.default ?? false
  if (field.type === "string") return field.default
  if (field.type === "multiselect") return field.default ? [...field.default] : []
  return undefined
}

function textValue(value: FormValue | undefined) {
  return typeof value === "string" ? value : ""
}

function selected(value: FormValue | undefined) {
  return Array.isArray(value) ? value : []
}
