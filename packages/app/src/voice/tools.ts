import type { SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ServerCtx } from "@/runtime/server/runtime"
import { decodeArguments, type ToolCall } from "./protocol"
import { ReplyWatch } from "./replies"
import { messageExcerpts } from "./messages"

export class VoiceTools {
  readonly replies = new ReplyWatch()
  private calls = new Map<string, Promise<string>>()
  private observed = new Map<string, Map<string, string[]>>()

  constructor(
    private readonly ctx: ServerCtx,
    private readonly open: (session: SessionInfo) => void,
  ) {}

  run(call: ToolCall, request: { id: string; sessionID: string; voice: string }, signal: AbortSignal) {
    const existing = this.calls.get(call.call_id)

    if (existing) return existing

    const result = this.execute(call, request, signal)
      .then(JSON.stringify)
      .catch(() =>
        JSON.stringify({ error: "Tool request failed. Do not claim it succeeded or resend an uncertain admission." }),
      )

    this.calls.set(call.call_id, result)

    return result
  }

  answered(id: string) {
    this.observed.get(id)?.forEach((messages, sessionID) => this.replies.heard(sessionID, messages))
    this.observed.delete(id)
  }

  async history(sessionID: string, signal: AbortSignal) {
    const messages: SessionMessageInfo[] = []

    const page = async (cursor?: string): Promise<SessionMessageInfo[]> => {
      const result = await this.ctx.sdk.api.message.list(
        { sessionID, order: cursor ? undefined : "desc", limit: 100, cursor },
        { signal },
      )

      messages.unshift(...result.data.toReversed())

      if (this.replies.pending(sessionID).every((id) => messages.some((message) => message.id === id))) return messages

      if (result.data.length && result.cursor.next) return page(result.cursor.next)

      return messages
    }

    return page()
  }

  private async execute(
    call: ToolCall,
    request: { id: string; sessionID: string; voice: string },
    signal: AbortSignal,
  ) {
    signal.throwIfAborted()
    const args = decodeArguments(call.arguments)
    const api = this.ctx.sdk.api
    const sessionID = args.session_id ?? request.sessionID
    const options = { signal }

    if (call.name === "list_sessions" || call.name === "search_sessions") {
      if (call.name === "search_sessions" && !args.query) throw new Error("query required")

      return api.session.list({ limit: args.limit ?? 15, search: args.query, archived: false }, options)
    }

    if (call.name === "create_session") {
      const directory = args.directory

      if (!directory) throw new Error("directory required")
      const projects = await api.project.list({ archived: false }, options)

      if (!projects.some((project) => project.canonical === directory || project.sandboxes.includes(directory)))
        return { error: "Directory is not a known project or worktree on this server. No session was created." }

      const source = await api.session.get({ sessionID: request.sessionID }, options)
      signal.throwIfAborted()

      const created = this.ctx.data.session.create({
        location: { directory },
        title: args.title,
        model: source.model,
        agent: source.agent,
      })

      await created.request

      return { session_id: created.id }
    }

    if (call.name === "open_session") {
      if (!args.session_id) throw new Error("session_id required")
      const session = await api.session.get({ sessionID }, options)
      signal.throwIfAborted()
      this.open(session)

      return { opened: session.id, title: session.title }
    }

    if (call.name === "interrupt_session") {
      await api.session.interrupt({ sessionID }, options)

      return { interrupted: sessionID }
    }

    if (call.name === "send_message") {
      if (!args.text?.trim()) throw new Error("text required")
      const session = await api.session.get({ sessionID }, options)
      signal.throwIfAborted()
      const id = SessionMessage.ID.create()
      const prompt = { sessionID, promptID: id, title: session.title ?? session.id, instruction: args.text }
      // Register before admission: a network failure may still have delivered
      // the prompt. Keep this ID's watch across a dropped call and Rejoin.
      this.replies.sent(prompt)

      const admission = {
        sessionID,
        id,
        delivery: args.delivery ?? "steer",
        text: `Voice delegation.\n${JSON.stringify({ instruction: args.text, voice: request.voice })}`,
      }

      const result = await this.ctx.data.session.prompt(admission).then(
        () => ({ admitted: true }),
        async () => {
          const inbox = await api.session.inbox.list({ sessionID }, options)
          const history = await this.history(sessionID, signal)

          return { admitted: inbox.some((item) => item.id === id) || history.some((message) => message.id === id) }
        },
      )

      return {
        ...prompt,
        ...result,
        status: result.admitted ? "Work admitted; its reply will be announced." : "Admission uncertain; do not resend.",
      }
    }

    if (call.name === "read_session" || call.name === "wait_for_session") {
      if (call.name === "wait_for_session") {
        await api.session.wait({ sessionID }, { signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) })
      }

      const [session, messages] = await Promise.all([
        api.session.get({ sessionID }, options),
        api.message.list(
          { sessionID, limit: args.limit ?? 20, order: args.cursor ? undefined : "desc", cursor: args.cursor },
          options,
        ),
      ])

      const observed = this.observed.get(request.id) ?? new Map<string, string[]>()
      observed.set(sessionID, [
        ...(observed.get(sessionID) ?? []),
        ...messages.data
          .filter((message) => message.type === "assistant" && message.time.completed)
          .map((message) => message.id),
      ])
      this.observed.set(request.id, observed)

      return {
        session: { id: session.id, title: session.title, outcome: session.outcome, time: session.time },
        messages: { data: messageExcerpts(messages.data), cursor: messages.cursor },
      }
    }

    throw new Error("Unknown voice tool")
  }
}
