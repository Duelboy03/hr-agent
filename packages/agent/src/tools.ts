import { addDays, businessDays, cmp, isDate, type ISODate } from './dates'
import { ENTITLEMENT, type Employee, type Hris, type LeaveStatus, type LeaveType } from './hris'
import { searchPolicies } from './policies'
import type { Role, ToolSpec } from './types'

export class ToolError extends Error {}

export interface ToolContext {
  hris: Hris
  actor: Employee
}

export interface Tool {
  spec: ToolSpec
  /** write tools change the system of record, so a person must approve each call */
  write: boolean
  roles: Role[]
  run(input: Record<string, unknown>, ctx: ToolContext): unknown
  /** plain-language description of exactly what an approved call will do, written by code from the real input */
  describe?(input: Record<string, unknown>, ctx: ToolContext): string
}

const ALL: Role[] = ['employee', 'manager', 'hr_admin']
const MANAGERS: Role[] = ['manager', 'hr_admin']
const LEAVE_TYPES = ['vacation', 'sick', 'personal', 'unpaid'] as const
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const

const str = (v: unknown, name: string, max = 300): string => {
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`${name} is required.`)
  return v.trim().slice(0, max)
}
const leaveType = (v: unknown): LeaveType => {
  if (!LEAVE_TYPES.includes(v as LeaveType)) throw new ToolError(`type must be one of ${LEAVE_TYPES.join(', ')}.`)
  return v as LeaveType
}
const date = (v: unknown, name: string): ISODate => {
  if (!isDate(v)) throw new ToolError(`${name} must be a real date in YYYY-MM-DD format.`)
  return v
}
const fmtDay = (d: ISODate) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
const range = (a: ISODate, b: ISODate) => (a === b ? fmtDay(a) : `${fmtDay(a)} to ${fmtDay(b)}`)
const num = (n: number) => String(+n.toFixed(2))

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec['input_schema'] => ({ type: 'object', properties, required })
const TYPE_PROP = { type: 'string', enum: [...LEAVE_TYPES], description: 'Kind of leave' }
const DATE_PROP = (what: string) => ({ type: 'string', description: `${what}, as YYYY-MM-DD` })

export const TOOLS: Tool[] = [
  {
    spec: { name: 'get_my_profile', description: 'Get the signed-in employee\'s name, title, department, manager and start date.', input_schema: obj({}) },
    write: false,
    roles: ALL,
    run: (_i, { hris, actor }) => ({ name: actor.name, title: actor.title, department: actor.department, role: actor.role, manager: actor.managerId ? hris.get(actor.managerId)?.name : null, hire_date: actor.hireDate }),
  },
  {
    spec: { name: 'get_leave_balance', description: 'Get the signed-in employee\'s leave balance as of today: days accrued this year, used, pending approval and still available. Omit type for all kinds.', input_schema: obj({ type: TYPE_PROP }) },
    write: false,
    roles: ALL,
    run: (i, { hris, actor }) => {
      const types = i.type === undefined ? (['vacation', 'sick', 'personal'] as LeaveType[]) : [leaveType(i.type)]
      return types.map((t) => {
        const b = hris.balance(actor.id, t)
        return { type: t, annual_allowance: ENTITLEMENT[t], accrued_so_far: b.accrued, used: b.used, pending_approval: b.pending, available: Number.isFinite(b.available) ? +b.available.toFixed(2) : 'unlimited (unpaid, needs approval)' }
      })
    },
  },
  {
    spec: { name: 'list_my_leave_requests', description: 'List the signed-in employee\'s own leave requests, newest first. Optionally filter by status.', input_schema: obj({ status: { type: 'string', enum: [...STATUSES] } }) },
    write: false,
    roles: ALL,
    run: (i, { hris, actor }) => {
      if (i.status !== undefined && !STATUSES.includes(i.status as LeaveStatus)) throw new ToolError(`status must be one of ${STATUSES.join(', ')}.`)
      return hris.requests
        .filter((r) => r.employeeId === actor.id && (i.status === undefined || r.status === i.status))
        .sort((a, b) => cmp(b.startDate, a.startDate))
        .map((r) => ({ id: r.id, type: r.type, start_date: r.startDate, end_date: r.endDate, working_days: r.days, status: r.status, reason: r.reason }))
    },
  },
  {
    spec: { name: 'check_leave_request', description: 'Dry run: check whether a leave request would be allowed (working days, notice, overlaps, balance) without submitting anything. Always call this before submit_leave_request.', input_schema: obj({ type: TYPE_PROP, start_date: DATE_PROP('First day of leave'), end_date: DATE_PROP('Last day of leave (same as start for one day)') }, ['type', 'start_date', 'end_date']) },
    write: false,
    roles: ALL,
    run: (i, { hris, actor }) => {
      const c = hris.check(actor.id, leaveType(i.type), date(i.start_date, 'start_date'), date(i.end_date, 'end_date'))
      return { allowed: c.ok, working_days: c.days, problems: c.errors, warnings: c.warnings, balance_after: c.balanceAfter }
    },
  },
  {
    spec: { name: 'submit_leave_request', description: 'Submit a leave request for the signed-in employee. This changes records, so the employee is asked to approve it first. Check it with check_leave_request beforehand.', input_schema: obj({ type: TYPE_PROP, start_date: DATE_PROP('First day of leave'), end_date: DATE_PROP('Last day of leave'), reason: { type: 'string', description: 'Optional note for the manager' } }, ['type', 'start_date', 'end_date']) },
    write: true,
    roles: ALL,
    run: (i, { hris, actor }) => {
      try {
        const r = hris.submit(actor.id, leaveType(i.type), date(i.start_date, 'start_date'), date(i.end_date, 'end_date'), typeof i.reason === 'string' ? i.reason : '')
        return { id: r.id, status: r.status, working_days: r.days, goes_to: actor.managerId ? hris.get(actor.managerId)?.name : 'HR' }
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : 'Could not submit that.')
      }
    },
    describe: (i, { hris, actor }) => {
      const t = leaveType(i.type)
      const s = date(i.start_date, 'start_date')
      const e = date(i.end_date, 'end_date')
      const c = hris.check(actor.id, t, s, e)
      const bal = hris.balance(actor.id, t, s)
      const after = c.balanceAfter !== null && Number.isFinite(bal.available) ? ` On ${fmtDay(s)} your ${t} balance would go from ${num(bal.available)} to ${num(c.balanceAfter)} days.` : ''
      return `Submit a ${t} request for ${range(s, e)} (${c.days} working day${c.days === 1 ? '' : 's'}) to ${actor.managerId ? hris.get(actor.managerId)?.name : 'HR'}.${after}`
    },
  },
  {
    spec: { name: 'cancel_leave_request', description: 'Cancel one of the signed-in employee\'s own pending or future approved leave requests. The employee is asked to approve first.', input_schema: obj({ request_id: { type: 'string', description: 'Request id such as LV-102' } }, ['request_id']) },
    write: true,
    roles: ALL,
    run: (i, { hris, actor }) => {
      const id = str(i.request_id, 'request_id', 20)
      const r = hris.requests.find((x) => x.id === id)
      // owners may cancel their own requests; nobody else can through this tool
      if (!r || r.employeeId !== actor.id) throw new ToolError(`You have no request ${id}.`)
      try {
        const out = hris.decide(id, 'cancel', actor.id)
        return { id: out.id, status: out.status }
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : 'Could not cancel that.')
      }
    },
    describe: (i, { hris }) => {
      const r = hris.requests.find((x) => x.id === String(i.request_id))
      return r ? `Cancel request ${r.id}: ${r.type} for ${range(r.startDate, r.endDate)} (${r.status}).` : `Cancel request ${String(i.request_id)} (not found).`
    },
  },
  {
    spec: { name: 'get_latest_payslip', description: 'Get the signed-in employee\'s most recent payslip: pay date, period, gross, taxes, deductions and net pay.', input_schema: obj({}) },
    write: false,
    roles: ALL,
    run: (_i, { hris, actor }) => {
      const p = hris.latestPayslip(actor.id)
      return { pay_date: p.payDate, period: `${p.periodStart} to ${p.periodEnd}`, gross: p.gross, taxes: p.taxes, deductions: p.deductions, net_pay: p.net, currency: 'USD' }
    },
  },
  {
    spec: { name: 'get_company_holidays', description: 'List company holidays, optionally between two dates. Defaults to the next 90 days.', input_schema: obj({ from: DATE_PROP('Start of the window'), to: DATE_PROP('End of the window') }) },
    write: false,
    roles: ALL,
    run: (i, { hris }) => {
      const from = i.from === undefined ? hris.today : date(i.from, 'from')
      const to = i.to === undefined ? addDays(from, 90) : date(i.to, 'to')
      return [...hris.holidays.entries()].filter(([d]) => cmp(d, from) >= 0 && cmp(d, to) <= 0).sort((a, b) => cmp(a[0], b[0])).map(([d, name]) => ({ date: d, name }))
    },
  },
  {
    spec: { name: 'search_policy', description: 'Search the company handbook (time off, sick leave, parental leave, expenses, remote work, payroll, security). Returns the best matching sections with their text. Use it for any policy question and cite the section.', input_schema: obj({ query: { type: 'string', description: 'What to look up, in plain words' } }, ['query']) },
    write: false,
    roles: ALL,
    run: (i) => searchPolicies(str(i.query, 'query', 200), 3).map((h) => ({ document: h.title, section: h.section, text: h.text, relevance: +h.score.toFixed(2), question_words_matched: h.matched, share_of_question_matched: +h.coverage.toFixed(2) })),
  },
  {
    spec: { name: 'get_team_availability', description: 'Who is away (approved leave) between two dates. Employees see their own team; managers their reports; HR everyone. Defaults to the next 14 days.', input_schema: obj({ from: DATE_PROP('Start of the window'), to: DATE_PROP('End of the window') }) },
    write: false,
    roles: ALL,
    run: (i, { hris, actor }) => {
      const from = i.from === undefined ? hris.today : date(i.from, 'from')
      const to = i.to === undefined ? addDays(from, 14) : date(i.to, 'to')
      const visible = (id: string) => actor.role === 'hr_admin' || hris.get(id)?.department === actor.department
      return hris.requests
        .filter((r) => r.status === 'approved' && visible(r.employeeId) && cmp(r.endDate, from) >= 0 && cmp(r.startDate, to) <= 0)
        .map((r) => ({ name: hris.get(r.employeeId)!.name, start_date: r.startDate, end_date: r.endDate, working_days: businessDays(r.startDate, r.endDate, hris.holidaySet()) }))
    },
  },
  {
    spec: { name: 'list_pending_approvals', description: 'List leave requests waiting for the signed-in manager (their direct reports) or HR (everyone except themselves).', input_schema: obj({}) },
    write: false,
    roles: MANAGERS,
    run: (_i, { hris, actor }) =>
      hris.requests
        .filter((r) => r.status === 'pending' && r.employeeId !== actor.id && (actor.role === 'hr_admin' || hris.isManagerOf(actor.id, r.employeeId)))
        .map((r) => ({ id: r.id, employee: hris.get(r.employeeId)!.name, type: r.type, start_date: r.startDate, end_date: r.endDate, working_days: r.days, // the reason is written by the employee, so it is passed on as quoted data
          employee_note: r.reason })),
  },
  {
    spec: { name: 'decide_leave_request', description: 'Approve or decline a pending leave request. Only the employee\'s manager or HR may decide, never for their own request. The person is asked to approve this action first.', input_schema: obj({ request_id: { type: 'string', description: 'Request id such as LV-102' }, decision: { type: 'string', enum: ['approve', 'reject'] } }, ['request_id', 'decision']) },
    write: true,
    roles: MANAGERS,
    run: (i, { hris, actor }) => {
      const id = str(i.request_id, 'request_id', 20)
      if (i.decision !== 'approve' && i.decision !== 'reject') throw new ToolError('decision must be approve or reject.')
      const r = hris.requests.find((x) => x.id === id)
      if (!r) throw new ToolError(`There is no request ${id}.`)
      if (r.employeeId === actor.id) throw new ToolError('You cannot decide your own request.')
      if (actor.role !== 'hr_admin' && !hris.isManagerOf(actor.id, r.employeeId)) throw new ToolError(`${hris.get(r.employeeId)?.name ?? 'That employee'} does not report to you.`)
      try {
        const out = hris.decide(id, i.decision, actor.id)
        return { id: out.id, employee: hris.get(out.employeeId)!.name, status: out.status }
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : 'Could not decide that.')
      }
    },
    describe: (i, { hris }) => {
      const r = hris.requests.find((x) => x.id === String(i.request_id))
      if (!r) return `${i.decision === 'approve' ? 'Approve' : 'Decline'} request ${String(i.request_id)} (not found).`
      const e = hris.get(r.employeeId)!
      return `${i.decision === 'approve' ? 'Approve' : 'Decline'} ${e.name}'s ${r.type} request for ${range(r.startDate, r.endDate)} (${r.days} working day${r.days === 1 ? '' : 's'}).`
    },
  },
]

export const toolsFor = (role: Role): Tool[] => TOOLS.filter((t) => t.roles.includes(role))
export const findTool = (name: string): Tool | undefined => TOOLS.find((t) => t.spec.name === name)
