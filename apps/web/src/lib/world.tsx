import { AgentSession, AuditLog, ClaudePlanner, Hris, RulesPlanner, type AgentEvent, type Block, type PlanRequest, type Planner } from '@hr-agent/agent'
import { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'

export const PERSONAS = [
  { id: 'meera', role: 'Employee', blurb: 'Asks about her own leave and pay' },
  { id: 'arjun', role: 'Manager', blurb: 'Decides his team\'s requests' },
  { id: 'priya', role: 'HR admin', blurb: 'Can decide for anyone' },
] as const
export type PersonaId = (typeof PERSONAS)[number]['id']

export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'step'; id: string; callId: string; tool: string; input: Record<string, unknown>; write: boolean; status: 'running' | 'awaiting' | 'ok' | 'error' | 'declined'; output?: unknown; ms?: number }
  | { kind: 'approval'; id: string; callId: string; tool: string; input: Record<string, unknown>; summary: string; state: 'pending' | 'approved' | 'declined' }
  | { kind: 'error'; id: string; text: string }

export interface Settings {
  claudeKey: string
  claudeModel: string
}

interface Chat {
  session: AgentSession
  items: Item[]
  busy: boolean
}

interface World {
  hris: Hris
  audit: AuditLog
  persona: PersonaId
  setPersona: (p: PersonaId) => void
  chat: Chat
  send: (text: string) => void
  resolve: (callId: string, approve: boolean) => void
  stop: () => void
  settings: Settings
  setSettings: (s: Partial<Settings>) => void
  plannerName: 'rules' | 'claude'
  /** bumps whenever the system of record or the audit log changes, so panels re-render */
  version: number
}

const Ctx = createContext<World | null>(null)
export const useWorld = () => {
  const w = useContext(Ctx)
  if (!w) throw new Error('useWorld must be used inside <WorldProvider>')
  return w
}

/** Picks the planner each time it is asked, so pasting an API key takes effect on the next message. */
class SwitchingPlanner implements Planner {
  constructor(private pick: () => Planner) {}
  get name() {
    return this.pick().name
  }
  plan(req: PlanRequest): Promise<Block[]> {
    return this.pick().plan(req)
  }
}

let seq = 0
const nid = () => `i${++seq}`

export function WorldProvider({ children, today }: { children: ReactNode; today?: string }) {
  const hris = useMemo(() => new Hris(today ?? new Date().toISOString().slice(0, 10)), [today])
  const audit = useMemo(() => new AuditLog(), [])
  const [persona, setPersonaState] = useState<PersonaId>('meera')
  const [settings, setSettingsState] = useState<Settings>({ claudeKey: '', claudeModel: 'claude-sonnet-5-5' })
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const chats = useRef(new Map<PersonaId, Chat>())
  const aborts = useRef(new Map<PersonaId, AbortController>())

  const planner = useMemo(
    () =>
      new SwitchingPlanner(() => {
        const s = settingsRef.current
        return s.claudeKey ? new ClaudePlanner({ apiKey: s.claudeKey, model: s.claudeModel, browser: true }) : new RulesPlanner(() => hris.today)
      }),
    [hris],
  )

  const chatFor = useCallback(
    (p: PersonaId): Chat => {
      let c = chats.current.get(p)
      if (!c) {
        c = { session: new AgentSession({ hris, actor: hris.get(p)!, planner, audit }), items: [], busy: false }
        chats.current.set(p, c)
      }
      return c
    },
    [hris, planner, audit],
  )

  const apply = useCallback(
    (p: PersonaId, ev: AgentEvent) => {
      const c = chatFor(p)
      const items = c.items.slice()
      switch (ev.type) {
        case 'text':
          items.push({ kind: 'agent', id: nid(), text: ev.text })
          break
        case 'step':
          items.push({ kind: 'step', id: nid(), callId: ev.callId, tool: ev.tool, input: ev.input, write: ev.write, status: 'running' })
          break
        case 'result': {
          const i = items.findIndex((x) => x.kind === 'step' && x.callId === ev.callId)
          if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: 'step' }>), status: ev.declined ? 'declined' : ev.ok ? 'ok' : 'error', output: ev.output, ms: ev.ms }
          break
        }
        case 'approval': {
          const i = items.findIndex((x) => x.kind === 'step' && x.callId === ev.callId)
          if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: 'step' }>), status: 'awaiting' }
          items.push({ kind: 'approval', id: nid(), callId: ev.callId, tool: ev.tool, input: ev.input, summary: ev.summary, state: 'pending' })
          break
        }
        case 'error':
          items.push({ kind: 'error', id: nid(), text: ev.message })
          break
      }
      c.items = items
      c.busy = ev.type === 'done' || ev.type === 'error' ? false : ev.type === 'approval' ? false : true
      bump()
    },
    [chatFor],
  )

  const drive = useCallback(
    async (p: PersonaId, gen: AsyncGenerator<AgentEvent>) => {
      const c = chatFor(p)
      c.busy = true
      bump()
      try {
        for await (const ev of gen) apply(p, ev)
      } finally {
        if (!c.session.awaitingApproval) c.busy = false
        bump()
      }
    },
    [apply, chatFor],
  )

  const send = useCallback(
    (text: string) => {
      const t = text.trim()
      const c = chatFor(persona)
      if (!t || c.busy || c.session.awaitingApproval) return
      c.items = [...c.items, { kind: 'user', id: nid(), text: t }]
      const ctl = new AbortController()
      aborts.current.set(persona, ctl)
      void drive(persona, c.session.send(t, ctl.signal))
    },
    [chatFor, drive, persona],
  )

  const resolve = useCallback(
    (callId: string, approve: boolean) => {
      const c = chatFor(persona)
      c.items = c.items.map((x) => (x.kind === 'approval' && x.callId === callId ? { ...x, state: approve ? 'approved' : 'declined' } : x))
      const ctl = new AbortController()
      aborts.current.set(persona, ctl)
      void drive(persona, c.session.resolve(callId, approve, ctl.signal))
    },
    [chatFor, drive, persona],
  )

  const stop = useCallback(() => aborts.current.get(persona)?.abort(), [persona])

  const value: World = {
    hris,
    audit,
    persona,
    setPersona: setPersonaState,
    chat: chatFor(persona),
    send,
    resolve,
    stop,
    settings,
    setSettings: (s) => setSettingsState((x) => ({ ...x, ...s })),
    plannerName: settings.claudeKey ? 'claude' : 'rules',
    version: version + audit.list().length,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
