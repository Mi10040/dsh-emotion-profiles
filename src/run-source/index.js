/**
 * Run source: the plugin's own turn collector.
 *
 * It subscribes to the host's durable turn lifecycle and derives one RunRecord
 * per finished turn. This is the only place the plugin reads conversation-like
 * data, and it reads committed Session events only — it does not subscribe to
 * any other plugin's events, inject any other service, or touch any other
 * storage root.
 *
 * Events used (all owned by the host Session/agent loop):
 *   turn/start, user/message, assistant/message, tool/result, step/end,
 *   turn/end, compaction/summary
 * Plus `session/flush` (awaited durability checkpoint) and `session/disposed`.
 */
import { buildRunRecord, detectConflict, statusFromReason } from './schema.js'
import { charCount, firstLine, isHumanMessage, textOfContent } from './extract.js'

function newAccumulator(turn, startedAt) {
  return {
    turn,
    startedAt,
    firstUserGoal: '',
    summary: '',
    assistantChars: 0,
    toolCalls: 0,
    toolErrors: 0,
    conflict: false,
    userMessages: 0,
    steps: 0,
    interrupted: false,
    compacted: false,
  }
}

export class RunCollector {
  /**
   * @param {{ onRun: (record: object, session: object) => void, onFlush?: () => Promise<void> | void, logger?: object, debug?: boolean }} options
   */
  constructor({ onRun, onFlush = null, logger = null, debug = false }) {
    this.onRun = onRun
    this.onFlush = onFlush
    this.logger = logger
    this.debug = debug
    this.turns = new Map()
  }

  /** Register host listeners; returns the disposer that removes all of them. */
  attach(ctx) {
    const disposers = [
      ctx.on('session/event', (session, event) => this.handleEvent(session, event)),
      ctx.on('session/flush', () => this.flush()),
      ctx.on('session/disposed', (session) => {
        if (session?.id) this.turns.delete(session.id)
      }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          // already disposed by the owning plugin context
        }
      }
      this.turns.clear()
    }
  }

  async flush() {
    try {
      await this.onFlush?.()
    } catch (error) {
      this.logger?.debug?.(`run flush failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  handleEvent(session, event) {
    try {
      const sessionId = session?.id
      const type = event?.type
      if (!sessionId || !type) return
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      const at = Number(event.time) || Date.now()

      if (type === 'turn/start') {
        this.turns.set(sessionId, newAccumulator(Number(data.turn) || 0, at))
        return
      }

      let acc = this.turns.get(sessionId)
      if (!acc) {
        // The plugin can be enabled in the middle of a turn, after `turn/start`
        // already passed. Start a late accumulator on the first human message so
        // that turn still produces a record; turn 0 never collides with a real
        // (1-based) turn number.
        if (type !== 'user/message') return
        acc = newAccumulator(0, at)
        this.turns.set(sessionId, acc)
      }

      if (type === 'turn/end') {
        this.turns.delete(sessionId)
        this.emit(session, acc, data, at)
        return
      }

      this.applyTurnEvent(acc, type, data)
    } catch (error) {
      this.logger?.debug?.(`run collector ignored an event: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  applyTurnEvent(acc, type, data) {
    switch (type) {
      case 'user/message': {
        // `data` is the UserMessage itself for this event type.
        if (!isHumanMessage(data)) return
        const text = textOfContent(data.content)
        if (text === '') return
        acc.userMessages += 1
        if (acc.firstUserGoal === '') acc.firstUserGoal = firstLine(text, 200)
        if (detectConflict(text)) acc.conflict = true
        return
      }
      case 'assistant/message': {
        const text = textOfContent(data.message?.content)
        if (text !== '') {
          acc.summary = text
          acc.assistantChars += charCount(text)
        }
        if (data.interrupted === true) acc.interrupted = true
        return
      }
      case 'tool/result': {
        acc.toolCalls += 1
        if (data.error || data.message?.isError === true) acc.toolErrors += 1
        return
      }
      case 'step/end': {
        acc.steps += 1
        return
      }
      case 'compaction/summary': {
        acc.compacted = true
        return
      }
      default:
        return
    }
  }

  emit(session, acc, data, endedAt) {
    const status = acc.userMessages === 0 && acc.steps === 0 ? 'empty' : statusFromReason(data.reason)
    if (data.reason && data.reason.kind === 'aborted') acc.interrupted = true
    const record = buildRunRecord({
      sessionId: session.id,
      turn: acc.turn,
      startedAt: acc.startedAt,
      endedAt,
      status,
      firstUserGoal: acc.firstUserGoal,
      summary: acc.summary,
      toolErrorCount: acc.toolErrors,
      toolCallCount: acc.toolCalls,
      conflictFlag: acc.conflict,
      userMessages: acc.userMessages,
      steps: acc.steps,
      assistantChars: acc.assistantChars,
      interrupted: acc.interrupted,
      compacted: acc.compacted,
    })
    if (this.debug) {
      this.logger?.debug?.(
        `run ${record.id} status=${record.status} errors=${record.toolErrorCount} conflict=${record.conflictFlag} score=${record.outcomeScore}`,
      )
    }
    try {
      this.onRun(record, session)
    } catch (error) {
      this.logger?.warn?.(`run handler failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
