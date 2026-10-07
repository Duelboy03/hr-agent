import clsx from 'clsx'
import { KeyRound, Menu, Moon, PanelRight, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Composer, Conversation } from './components/Chat'
import { SidePanel } from './components/Panels'
import { PERSONAS, useWorld } from './lib/world'

function useTheme(): ['dark' | 'light', () => void] {
  const [t, setT] = useState<'dark' | 'light'>(() => {
    try {
      const s = localStorage.getItem('aide:theme')
      if (s === 'dark' || s === 'light') return s
      return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = t
    try {
      localStorage.setItem('aide:theme', t)
    } catch {
      /* storage blocked */
    }
  }, [t])
  return [t, () => setT((x) => (x === 'dark' ? 'light' : 'dark'))]
}

function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, setSettings } = useWorld()
  const [key, setKey] = useState(settings.claudeKey)
  useEffect(() => {
    if (open) setKey(settings.claudeKey)
  }, [open, settings.claudeKey])
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  const input = 'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Settings" className="enter relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">Settings</h2><button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-sub hover:bg-surface-2"><X size={18} /></button></div>
        <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} className="text-accent" /> Planner</h3>
        <p className="mb-3 text-xs leading-relaxed text-sub">By default a small rules-based planner picks the tools. It handles a fixed set of requests but is deterministic and free. Paste an Anthropic API key and Claude plans instead, choosing and sequencing the same tools for any request, under the same approval rules.</p>
        <label className="block text-[13px] font-medium">Anthropic API key
          <input type="password" autoComplete="off" spellCheck={false} className={clsx(input, 'mt-1.5')} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
        </label>
        <p className="mt-1.5 text-xs text-sub">Kept in memory for this tab only and sent straight to api.anthropic.com. Never stored.</p>
        <label className="mt-4 block text-[13px] font-medium">Model
          <input className={clsx(input, 'mt-1.5')} value={settings.claudeModel} onChange={(e) => setSettings({ claudeModel: e.target.value })} />
        </label>
        <div className="mt-5 flex justify-end"><button onClick={() => { setSettings({ claudeKey: key.trim() }); onClose() }} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:brightness-110">Done</button></div>
      </div>
    </div>
  )
}

export default function App() {
  const { persona, setPersona, plannerName, hris } = useWorld()
  const [theme, toggleTheme] = useTheme()
  const [settings, setSettings] = useState(false)
  const [panel, setPanel] = useState(false)
  const [menu, setMenu] = useState(false)

  const nav = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink"><span className="text-base font-bold leading-none">A</span></span>
        <div><p className="text-[15px] font-semibold leading-none tracking-tight">Aide</p><p className="mt-1 text-[11px] text-sub">HR agent · Northwind Labs</p></div>
      </div>
      <p className="px-5 pb-2 text-xs font-semibold uppercase tracking-wider text-sub">Signed in as</p>
      <ul className="space-y-1 px-3" role="radiogroup" aria-label="Signed in as">
        {PERSONAS.map((p) => {
          const e = hris.get(p.id)!
          return (
            <li key={p.id}>
              <button role="radio" aria-checked={persona === p.id} onClick={() => { setPersona(p.id); setMenu(false) }} className={clsx('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors', persona === p.id ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-surface-2')}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">{e.name.split(' ').map((x) => x[0]).join('')}</span>
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{e.name}</span><span className="block text-xs text-sub">{p.role}</span></span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mx-5 mt-5 rounded-xl border border-line bg-surface-2/50 p-3.5 text-xs leading-relaxed text-sub">
        <p className="font-semibold text-ink">What the agent can do for {hris.get(persona)!.name.split(' ')[0]}</p>
        <p className="mt-1.5">{persona === 'meera' ? 'Look up balances, requests, payslips, holidays and policy. Book or cancel her own leave, with her approval.' : persona === 'arjun' ? 'Everything an employee can, plus see and decide leave for his direct reports, with his approval.' : 'Everything above, and decide leave for anyone. Still never her own.'}</p>
      </div>
      <div className="mt-auto flex items-center gap-1 border-t border-line p-3">
        <button onClick={() => setSettings(true)} className="flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-sub hover:bg-surface-2 hover:text-ink"><KeyRound size={16} /> Planner: {plannerName === 'claude' ? 'Claude' : 'rules'}</button>
        <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} className="rounded-lg p-2 text-sub hover:bg-surface-2 hover:text-ink">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      </div>
    </div>
  )

  return (
    <div className="flex h-full" style={{ backgroundImage: 'radial-gradient(800px 340px at 45% -120px, var(--glow), transparent 70%)', backgroundRepeat: 'no-repeat' }}>
      <aside className="hidden w-72 shrink-0 border-r border-line lg:block">{nav}</aside>
      {menu && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/60" onClick={() => setMenu(false)} /><aside className="enter absolute inset-y-0 left-0 w-80 max-w-[88vw] border-r border-line">{nav}</aside></div>}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur">
          <button onClick={() => setMenu(true)} aria-label="Menu" className="rounded-lg p-1.5 text-sub hover:bg-surface-2 lg:hidden"><Menu size={20} /></button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-sub" data-testid="planner-badge"><span className={clsx('h-1.5 w-1.5 rounded-full', plannerName === 'claude' ? 'bg-accent' : 'bg-sub')} />{plannerName === 'claude' ? 'Planner: Claude' : 'Planner: rules (offline)'}</span>
          <button onClick={() => setPanel((p) => !p)} aria-label="Records, trace and audit" className="ml-auto rounded-lg p-1.5 text-sub hover:bg-surface-2 xl:hidden"><PanelRight size={20} /></button>
        </header>
        <Conversation />
        <Composer />
      </main>

      <aside className="hidden w-[22rem] shrink-0 border-l border-line bg-surface xl:block"><SidePanel /></aside>
      {panel && <div className="fixed inset-0 z-40 xl:hidden"><div className="absolute inset-0 bg-black/60" onClick={() => setPanel(false)} /><aside className="enter absolute inset-y-0 right-0 w-96 max-w-[92vw] border-l border-line bg-surface"><SidePanel /></aside></div>}
      <Settings open={settings} onClose={() => setSettings(false)} />
    </div>
  )
}
