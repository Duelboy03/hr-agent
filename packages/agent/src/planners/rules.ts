import { addDays, cmp, parseDates, type ISODate } from '../dates'
import type { Block, Message, PlanRequest, Planner } from '../types'

interface Done {
  name: string
  input: Record<string, unknown>
  ok: boolean
  data: unknown
}

const DECLINED = 'The user declined this action. Nothing was changed.'
const isDeclined = (d: Done) => d.data === DECLINED

let counter = 0
const id = () => `toolu_rules_${++counter}`
const call = (name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id: id(), name, input })
const say = (text: string): Block[] => [{ type: 'text', text }]

const fmtDay = (d: ISODate) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
const range = (a: ISODate, b: ISODate) => (a === b ? fmtDay(a) : `${fmtDay(a)} to ${fmtDay(b)}`)
const num = (n: number) => String(+Number(n).toFixed(2))
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** the latest plain user message, and what has been done since it */
function situation(messages: Message[]): { text: string; done: Done[] } {
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content === 'string') lastUser = i
  })
  const text = lastUser >= 0 ? (messages[lastUser].content as string) : ''
  const uses = new Map<string, { name: string; input: Record<string, unknown> }>()
  const done: Done[] = []
  for (const m of messages.slice(lastUser + 1)) {
    if (typeof m.content === 'string') continue
    for (const b of m.content) {
      if (b.type === 'tool_use') uses.set(b.id, { name: b.name, input: b.input })
      else if (b.type === 'tool_result') {
        const u = uses.get(b.tool_use_id)
        if (!u) continue
        let data: unknown = b.content
        try {
          data = JSON.parse(b.content)
        } catch {
          /* plain text result */
        }
        done.push({ ...u, ok: !b.is_error, data })
      }
    }
  }
  return { text, done }
}

const TYPES = ['vacation', 'sick', 'personal', 'unpaid'] as const
const typeOf = (t: string) => TYPES.find((x) => t.includes(x)) ?? (/\b(holiday|pto|time off|days? off|leave|off)\b/.test(t) ? 'vacation' : undefined)

/**
 * A deterministic stand-in for a language model. It reads the conversation the same way a model would (the user's
 * message plus the tool results so far) and decides on the next tool call or the final reply. It exists so the
 * agent loop, approvals and guardrails can be demonstrated and tested without an API key. It understands a fixed
 * set of requests; Claude handles everything else.
 */
export class RulesPlanner implements Planner {
  readonly name = 'rules' as const

  constructor(private today: () => ISODate) {}

  async plan(req: PlanRequest): Promise<Block[]> {
    const { text, done } = situation(req.messages)
    const t = text.toLowerCase()
    const today = this.today()
    const last = done.at(-1)
    const find = (name: string) => done.filter((d) => d.name === name)

    // ---- manager and HR: decisions
    if (/\b(approve|decline|reject|deny)\b/.test(t) && req.tools.some((x) => x.name === 'decide_leave_request')) {
      const decision = /\b(decline|reject|deny)\b/.test(t) ? 'reject' : 'approve'
      const listed = find('list_pending_approvals')[0]
      if (!listed) return [call('list_pending_approvals')]
      const pending = (listed.data as { id: string; employee: string; type: string; start_date: string; end_date: string }[]) ?? []
      const idMatch = /\blv-\d+\b/i.exec(text)?.[0].toUpperCase()
      const targets = pending.filter((p) => (idMatch ? p.id === idMatch : /\b(all|everyone|every)\b/.test(t) || t.includes(p.employee.toLowerCase().split(' ')[0]) || t.includes(p.employee.toLowerCase())))
      const decided = find('decide_leave_request')
      const everyone = /\b(all|everyone|every)\b/.test(t)
      if (decided.length === 0 && targets.length > 1 && !idMatch && !everyone)
        return say(`There is more than one pending request that could match: ${targets.map((x) => `${x.id} (${x.employee}, ${x.type}, ${range(x.start_date, x.end_date)})`).join('; ')}. Tell me which id, or say "all".`)
      if (decided.length === 0 && targets.length === 0) return say(pending.length ? `I couldn't tell which request you mean. Waiting for you: ${pending.map((p) => `${p.employee} (${p.id})`).join(', ')}.` : 'There is nothing waiting for your decision.')
      if (decided.length < targets.length) return targets.filter((_, i) => i >= decided.length).map((x) => call('decide_leave_request', { request_id: x.id, decision }))
      const declinedByUser = decided.filter(isDeclined)
      const okd = decided.filter((d) => d.ok && !isDeclined(d))
      if (okd.length === 0) return say(declinedByUser.length === decided.length ? "Okay, I haven't changed anything." : `That didn't work: ${String(decided[0].data)}`)
      return say(okd.map((d) => `${(d.data as { employee: string }).employee}'s request ${(d.data as { id: string }).id} is now ${(d.data as { status: string }).status}.`).join(' ') + (declinedByUser.length ? ` I left ${declinedByUser.length} unchanged, as you asked.` : ''))
    }
    if (/\b(pending|waiting for|to approve|approvals?|need.* (approval|decision))\b/.test(t) && req.tools.some((x) => x.name === 'list_pending_approvals')) {
      if (!last) return [call('list_pending_approvals')]
      const rows = last.data as { id: string; employee: string; type: string; start_date: string; end_date: string; working_days: number }[]
      if (!last.ok) return say(String(last.data))
      return say(rows.length ? `${rows.length} request${rows.length === 1 ? ' is' : 's are'} waiting for you:\n${rows.map((r) => `- ${r.employee}: ${r.type}, ${range(r.start_date, r.end_date)} (${r.working_days} working days), ${r.id}`).join('\n')}\nSay "approve ${rows[0].employee.split(' ')[0]}'s request" to decide one.` : 'Nothing is waiting for your decision.')
    }

    // ---- cancel
    if (/\bcancel\b/.test(t)) {
      const list = find('list_my_leave_requests')[0]
      if (!list) return [call('list_my_leave_requests')]
      const rows = (list.data as { id: string; type: string; start_date: string; end_date: string; status: string }[]).filter((r) => r.status === 'pending' || (r.status === 'approved' && cmp(r.start_date, today) > 0))
      const idMatch = /\blv-\d+\b/i.exec(text)?.[0].toUpperCase()
      const d = parseDates(text, today)
      let pick = rows
      if (idMatch) pick = rows.filter((r) => r.id === idMatch)
      else if (d.start) pick = rows.filter((r) => cmp(r.start_date, d.end ?? d.start!) <= 0 && cmp(r.end_date, d.start!) >= 0)
      else if (typeOf(t) && t.match(/\b(vacation|sick|personal|unpaid)\b/)) pick = rows.filter((r) => t.includes(r.type))
      const cancelled = find('cancel_leave_request')
      if (cancelled.length) {
        if (isDeclined(cancelled[0])) return say("Okay, I've left it as it was.")
        if (cancelled[0].ok) return say(`Done. ${(cancelled[0].data as { id: string }).id} is cancelled.`)
        return say(`I couldn't cancel it: ${String(cancelled[0].data)}`)
      }
      if (pick.length === 1) return [call('cancel_leave_request', { request_id: pick[0].id })]
      if (pick.length === 0) return say(rows.length ? `I couldn't find a matching request. You can cancel: ${rows.map((r) => `${r.id} (${r.type}, ${range(r.start_date, r.end_date)})`).join('; ')}.` : 'You have no pending or upcoming requests to cancel.')
      return say(`Which one? ${pick.map((r) => `${r.id} (${r.type}, ${range(r.start_date, r.end_date)})`).join('; ')}.`)
    }

    // ---- request leave
    if (/\b(book|request|take|apply|schedule|put in|need|want|going to be|will be)\b/.test(t) && /\b(off|leave|vacation|holiday|pto|sick|personal|unpaid)\b/.test(t) && !/\bhow (many|much)\b/.test(t) && !/\bpolicy\b/.test(t)) {
      const type = typeOf(t) ?? 'vacation'
      const d = parseDates(text, today)
      if (!d.start || !d.end) return say('Which dates? For example "next Monday to Wednesday" or "Dec 14 to Dec 18".')
      const check = find('check_leave_request')[0]
      if (!check) return [call('check_leave_request', { type, start_date: d.start, end_date: d.end })]
      const c = check.data as { allowed: boolean; working_days: number; problems: string[]; warnings: string[]; balance_after: number | null }
      if (!check.ok) return say(`I couldn't check that: ${String(check.data)}`)
      if (!c.allowed) return say(`I can't book that: ${c.problems.join(' ')}`)
      const sub = find('submit_leave_request')[0]
      if (!sub) return [call('submit_leave_request', { type, start_date: d.start, end_date: d.end, reason: /\bfor\s+(.{3,60}?)(?:[.!?]|$)/i.exec(text)?.[1] ?? '' })]
      if (isDeclined(sub)) return say("Okay, I haven't submitted anything. Want different dates?")
      if (!sub.ok) return say(`It wasn't submitted: ${String(sub.data)}`)
      const r = sub.data as { id: string; working_days: number; goes_to: string }
      return say(`Submitted ${r.id}: ${type} ${range(d.start, d.end)}, ${r.working_days} working day${r.working_days === 1 ? '' : 's'}. It's with ${r.goes_to} for approval.${c.balance_after !== null ? ` Your ${type} balance after this: ${num(c.balance_after)} days.` : ''}${c.warnings.length ? ` Note: ${c.warnings.join(' ')}` : ''}`)
    }

    // ---- balance
    if (/\b(balance|left|remaining|how (many|much).*(vacation|sick|personal|leave|days|pto|time off)|do i have)\b/.test(t) && /\b(vacation|sick|personal|leave|days|pto|time off|holiday)\b/.test(t)) {
      const ty = /\b(vacation|sick|personal)\b/.exec(t)?.[1]
      if (!last) return [call('get_leave_balance', ty ? { type: ty } : {})]
      if (!last.ok) return say(String(last.data))
      const rows = last.data as { type: string; available: number | string; used: number; pending_approval: number; accrued_so_far: number; annual_allowance: number }[]
      return say(rows.map((r) => `${r.type[0].toUpperCase()}${r.type.slice(1)}: ${num(Number(r.available))} days available (${num(r.accrued_so_far)} accrued of ${r.annual_allowance} a year, ${num(r.used)} used, ${num(r.pending_approval)} pending).`).join('\n'))
    }

    // ---- my requests
    if (/\b(my )?(leave )?requests?\b|\bstatus of\b|upcoming (leave|time off)|\bmy leave\b/.test(t)) {
      if (!last) return [call('list_my_leave_requests')]
      const rows = last.data as { id: string; type: string; start_date: string; end_date: string; status: string; working_days: number }[]
      return say(rows.length ? `Your requests:\n${rows.map((r) => `- ${r.id}: ${r.type}, ${range(r.start_date, r.end_date)} (${r.working_days} days), ${r.status}`).join('\n')}` : "You don't have any leave requests.")
    }

    // ---- payslip
    if (/\b(payslip|paycheck|pay slip|pay stub|salary slip|last (pay|salary)|net pay|take.?home|how much was i paid)\b/.test(t)) {
      if (!last) return [call('get_latest_payslip')]
      const p = last.data as { pay_date: string; period: string; gross: number; taxes: number; deductions: number; net_pay: number }
      return say(`Your latest payslip, paid ${fmtDay(p.pay_date)}: gross ${money(p.gross)}, taxes ${money(p.taxes)}, deductions ${money(p.deductions)}, net pay ${money(p.net_pay)}.`)
    }

    // ---- holidays
    if (/\b(company|public|upcoming|next|list|which|what|when).{0,30}holidays?\b|\bholidays? (this|next|coming)\b/.test(t) && !/\bfloating\b/.test(t)) {
      if (!last) return [call('get_company_holidays')]
      const rows = last.data as { date: string; name: string }[]
      return say(rows.length ? `Upcoming company holidays:\n${rows.map((r) => `- ${fmtDay(r.date)}: ${r.name}`).join('\n')}` : 'There are no company holidays in the next 90 days.')
    }

    // ---- availability
    if (/\bwho('s| is| are)?\b.{0,20}\b(out|off|away|on leave)\b|\bteam (calendar|availability)\b|\bout of office\b/.test(t)) {
      const d = parseDates(text, today)
      if (!last) return [call('get_team_availability', d.start ? { from: d.start, to: d.end ?? addDays(d.start, 0) } : {})]
      const rows = last.data as { name: string; start_date: string; end_date: string; working_days: number }[]
      return say(rows.length ? `Away:\n${rows.map((r) => `- ${r.name}: ${range(r.start_date, r.end_date)}`).join('\n')}` : 'Nobody on your team has approved time off in that window.')
    }

    // ---- profile
    if (/\b(my manager|who do i report|my profile|my details|who am i)\b/.test(t)) {
      if (!last) return [call('get_my_profile')]
      const p = last.data as { name: string; title: string; department: string; manager: string | null; hire_date: string }
      return say(`${p.name}, ${p.title} in ${p.department}. ${p.manager ? `You report to ${p.manager}.` : 'You have no manager on record.'} You joined on ${fmtDay(p.hire_date)}.`)
    }

    // ---- everything else is a policy question
    if (!last) return [call('search_policy', { query: text })]
    const hits = (last.data as { document: string; section: string; text: string; question_words_matched: number; share_of_question_matched: number }[]) ?? []
    // a single shared word ("code" in "dress code") is not an answer
    if (!last.ok || hits.length === 0 || hits[0].share_of_question_matched < 0.5 || hits[0].question_words_matched < 2) return say("I couldn't find that in the handbook. You could ask HR directly at people@northwind.example.")
    const top = hits[0]
    return say(`${top.text}\n\nSource: ${top.document} › ${top.section}.`)
  }
}
