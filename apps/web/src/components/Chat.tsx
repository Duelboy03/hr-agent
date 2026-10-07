import clsx from 'clsx'
import { ArrowUp, Check, ChevronRight, CircleAlert, Lock, Square, Wrench, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { label, SUGGESTIONS } from '../lib/labels'
import { PERSONAS, useWorld, type Item } from '../lib/world'

function Spinner() {
  return <span className="spin h-3.5 w-3.5 animate-spin rounded-full border-2 border-sub border-t-transparent" aria-label="Working" />
}

function StepRow({ item }: { item: Extract<Item, { kind: 'step' }> }) {
  const [open, setOpen] = useState(false)
  const icon =
    item.status === 'running' ? <Spinner /> : item.status === 'ok' ? <Check size={14} className="text-good" /> : item.status === 'declined' ? <X size={14} className="text-warn" /> : item.status === 'awaiting' ? <Lock size={14} className="text-warn" /> : <CircleAlert size={14} className="text-bad" />
  return (
    <div className="enter ml-10" data-testid="step" data-tool={item.tool} data-status={item.status}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-sub transition-colors hover:border-accent/50 hover:text-ink">
        {icon}
        {item.write ? <Lock size={12} className="text-muted" aria-label="Changes data" /> : <Wrench size={12} className="text-muted" />}
        <span className="truncate font-medium">{label(item.tool)}</span>
        {item.ms !== undefined && item.ms > 0 && <span className="font-mono text-[11px] text-muted">{Math.round(item.ms)} ms</span>}
        <ChevronRight size={13} className={clsx('text-muted transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="enter mt-1.5 space-y-2 rounded-lg border border-line bg-surface-2/60 p-3 font-mono text-[12px] leading-relaxed">
          <div><p className="mb-0.5 text-[11px] uppercase tracking-wide text-muted">Called with</p><pre className="whitespace-pre-wrap break-words text-sub">{JSON.stringify(item.input, null, 2)}</pre></div>
          {item.output !== undefined && <div><p className="mb-0.5 text-[11px] uppercase tracking-wide text-muted">Returned</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sub scroll-thin">{typeof item.output === 'string' ? item.output : JSON.stringify(item.output, null, 2)}</pre></div>}
        </div>
      )}
    </div>
  )
}

function ApprovalCard({ item }: { item: Extract<Item, { kind: 'approval' }> }) {
  const { resolve } = useWorld()
  const pending = item.state === 'pending'
  return (
    <div className={clsx('enter ml-10 rounded-2xl border p-4', pending ? 'border-warn/50 bg-warn/5' : 'border-line bg-surface')} data-testid="approval" data-state={item.state}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-warn"><Lock size={13} /> {pending ? 'Needs your approval' : item.state === 'approved' ? 'Approved' : 'Declined'}</p>
      <p className="mt-2 text-[15px] leading-relaxed">{item.summary}</p>
      {pending && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <button onClick={() => resolve(item.callId, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink hover:brightness-110"><Check size={15} /> Approve</button>
          <button onClick={() => resolve(item.callId, false)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"><X size={15} /> Decline</button>
          <span className="ml-1 text-xs text-muted">Nothing changes until you approve.</span>
        </div>
      )}
    </div>
  )
}

export function Conversation() {
  const { chat, persona, send } = useWorld()
  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const count = chat.items.length
  useEffect(() => {
    // keep the newest item (and any approval card) fully in view
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [count, chat.busy])
  const p = PERSONAS.find((x) => x.id === persona)!

  return (
    <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4">
      {count === 0 ? (
        <div className="enter mx-auto flex min-h-full max-w-2xl flex-col px-2 py-10">
          <div className="my-auto">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Aide · {p.role}</p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">An HR assistant that does things, and asks first.</h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-sub">
              It looks up balances, policies and payslips with tools, and can book, cancel or decide leave. Anything that changes a record shows you exactly what it will do and waits for your approval.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {SUGGESTIONS[persona].map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13.5px] text-sub transition-colors hover:border-accent/60 hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-3 py-8">
          {chat.items.map((it) => {
            if (it.kind === 'user') return <div key={it.id} className="enter flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-ink" data-testid="user-message">{it.text}</div></div>
            if (it.kind === 'agent') return (
              <div key={it.id} className="enter flex gap-3" data-testid="agent-message">
                <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><span className="text-sm font-bold">A</span></div>
                <div className="min-w-0 whitespace-pre-line text-[15px] leading-relaxed">{it.text}</div>
              </div>
            )
            if (it.kind === 'step') return <StepRow key={it.id} item={it} />
            if (it.kind === 'approval') return <ApprovalCard key={it.id} item={it} />
            return <div key={it.id} role="alert" className="enter ml-10 flex items-start gap-2.5 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad"><CircleAlert size={16} className="mt-0.5 shrink-0" />{it.text}</div>
          })}
          {chat.busy && <div className="ml-10 flex items-center gap-2 text-sm text-sub" role="status"><Spinner /> Working…</div>}
          <div ref={bottom} />
        </div>
      )}
    </div>
  )
}

export function Composer() {
  const { chat, send, stop } = useWorld()
  const [value, setValue] = useState('')
  const locked = chat.session.awaitingApproval
  const submit = () => {
    if (!value.trim() || chat.busy || locked) return
    send(value)
    setValue('')
  }
  return (
    <div className="border-t border-line bg-bg/90 px-4 pb-4 pt-3 backdrop-blur">
      <div className="mx-auto max-w-2xl">
        <div className={clsx('flex items-end gap-2 rounded-2xl border bg-surface p-2 shadow-lg', locked ? 'border-warn/40' : 'border-line focus-within:border-accent')}>
          <textarea
            value={value}
            rows={1}
            maxLength={500}
            disabled={locked}
            aria-label="Message the assistant"
            placeholder={locked ? 'Approve or decline the action above to continue…' : 'Ask, or tell it what to do…'}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {chat.busy ? (
            <button onClick={stop} aria-label="Stop" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 hover:bg-line"><Square size={14} fill="currentColor" /></button>
          ) : (
            <button onClick={submit} disabled={!value.trim() || locked} aria-label="Send" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink disabled:opacity-40"><ArrowUp size={18} strokeWidth={2.5} /></button>
          )}
        </div>
      </div>
    </div>
  )
}
