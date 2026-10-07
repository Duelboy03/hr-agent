import clsx from 'clsx'
import { Activity, Database, Route } from 'lucide-react'
import { useState } from 'react'
import { ENTITLEMENT, type LeaveStatus, type LeaveType } from '@hr-agent/agent'
import { label } from '../lib/labels'
import { PERSONAS, useWorld } from '../lib/world'

const fmt = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
const range = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`)

const STATUS: Record<LeaveStatus, string> = { pending: 'bg-warn/15 text-warn', approved: 'bg-good/15 text-good', rejected: 'bg-bad/15 text-bad', cancelled: 'bg-surface-2 text-muted' }

function Records() {
  const { hris, persona } = useWorld()
  const me = hris.get(persona)!
  const mine = hris.requests.filter((r) => r.employeeId === persona).sort((a, b) => b.startDate.localeCompare(a.startDate))
  const queue = me.role === 'employee' ? [] : hris.requests.filter((r) => r.status === 'pending' && r.employeeId !== persona && (me.role === 'hr_admin' || hris.isManagerOf(persona, r.employeeId)))
  return (
    <div className="space-y-6 p-4" data-testid="records">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub">Leave balance</h3>
        <ul className="space-y-3">
          {(['vacation', 'sick', 'personal'] as LeaveType[]).map((t) => {
            const b = hris.balance(persona, t)
            return (
              <li key={t}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="capitalize">{t}</span><span className="font-mono text-sub" data-testid={`balance-${t}`}>{+b.available.toFixed(2)} days</span></div>
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="bg-good/70" style={{ width: `${(b.used / ENTITLEMENT[t]) * 100}%` }} />
                  <div className="bg-warn/70" style={{ width: `${(b.pending / ENTITLEMENT[t]) * 100}%` }} />
                  <div className="bg-accent" style={{ width: `${(Math.max(0, b.available) / ENTITLEMENT[t]) * 100}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 flex gap-3 text-[11px] text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-good/70" />used</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-warn/70" />pending</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />available</span></p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub">My requests</h3>
        {mine.length === 0 ? <p className="text-[13px] text-muted">None.</p> : (
          <ul className="space-y-1.5">
            {mine.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[13px]" data-testid="request-row" data-id={r.id} data-status={r.status}>
                <span><span className="font-mono text-[11px] text-muted">{r.id}</span> <span className="capitalize">{r.type}</span> <span className="text-sub">{range(r.startDate, r.endDate)}</span></span>
                <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS[r.status])}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {me.role !== 'employee' && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub">Waiting on {me.role === 'hr_admin' ? 'HR' : 'you'}</h3>
          {queue.length === 0 ? <p className="text-[13px] text-muted">Nothing waiting.</p> : (
            <ul className="space-y-1.5">
              {queue.map((r) => (
                <li key={r.id} className="rounded-lg bg-surface-2/60 px-3 py-2 text-[13px]" data-testid="queue-row">
                  <span className="font-medium">{hris.get(r.employeeId)!.name}</span> <span className="text-sub">{r.type}, {range(r.startDate, r.endDate)}</span>
                  <span className="ml-1 font-mono text-[11px] text-muted">{r.id}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function Trace() {
  const { chat } = useWorld()
  const steps = chat.items.filter((i) => i.kind === 'step')
  return (
    <div className="p-4" data-testid="trace">
      <p className="mb-3 text-[13px] leading-relaxed text-sub">Every tool the agent called for this conversation, in order. Padlocks mark tools that change data.</p>
      {steps.length === 0 ? <p className="text-[13px] text-muted">No tool calls yet.</p> : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {steps.map((s, i) => s.kind === 'step' && (
            <li key={s.id} className="relative">
              <span className={clsx('absolute -left-[27px] top-1 grid h-3 w-3 place-items-center rounded-full border-2 border-bg', s.status === 'ok' ? 'bg-good' : s.status === 'error' ? 'bg-bad' : s.status === 'declined' || s.status === 'awaiting' ? 'bg-warn' : 'bg-sub')} />
              <p className="text-[13px] font-medium">{i + 1}. {label(s.tool)} {s.write && <span className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">writes</span>}</p>
              <code className="mt-1 block break-words font-mono text-[11.5px] leading-relaxed text-muted">{s.tool}({Object.entries(s.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})</code>
              <p className="mt-1 text-[12px] text-sub">{s.status === 'ok' ? `returned in ${Math.round(s.ms ?? 0)} ms` : s.status === 'awaiting' ? 'waiting for approval' : s.status === 'declined' ? 'declined by the user' : s.status === 'error' ? `failed: ${String(s.output)}` : 'running'}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const OUTCOME: Record<string, string> = { ok: 'bg-good/15 text-good', approved: 'bg-info/15 text-info', declined: 'bg-warn/15 text-warn', denied: 'bg-bad/15 text-bad', error: 'bg-bad/15 text-bad' }

function Audit() {
  const { audit, hris, persona } = useWorld()
  const me = hris.get(persona)!
  // HR sees everyone's activity; everybody else sees only their own
  const rows = [...audit.list()].reverse().filter((a) => me.role === 'hr_admin' || a.actor === me.name)
  return (
    <div className="p-4" data-testid="audit">
      <p className="mb-3 text-[13px] leading-relaxed text-sub">Append-only. Shows who asked for what, including actions that were denied or declined. {me.role === 'hr_admin' ? 'As HR you see everyone.' : 'You see your own activity.'}</p>
      {rows.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
        <ul className="space-y-2">
          {rows.map((a, i) => (
            <li key={i} className="rounded-lg border border-line px-3 py-2 text-[12.5px]" data-testid="audit-row" data-outcome={a.outcome}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium">{a.tool}</span>
                <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', OUTCOME[a.outcome])}>{a.outcome}</span>
              </div>
              <p className="mt-0.5 text-sub">{a.actor} · {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              <p className="mt-0.5 break-words text-muted">{a.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SidePanel() {
  const [tab, setTab] = useState<'records' | 'trace' | 'audit'>('records')
  const { persona } = useWorld()
  const tabs = [{ id: 'records', label: 'Records', icon: Database }, { id: 'trace', label: 'Trace', icon: Route }, { id: 'audit', label: 'Audit', icon: Activity }] as const
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex gap-1 border-b border-line p-2">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors', tab === t.id ? 'bg-accent-soft text-accent' : 'text-sub hover:bg-surface-2 hover:text-ink')}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" key={`${tab}-${persona}`}>
        {tab === 'records' ? <Records /> : tab === 'trace' ? <Trace /> : <Audit />}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-snug text-muted">{PERSONAS.find((p) => p.id === persona)!.blurb}. The “system of record” here is a small in-memory stand-in for an HRIS.</p>
    </div>
  )
}
