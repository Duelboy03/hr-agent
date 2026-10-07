import { describe, expect, it } from 'vitest'
import { findTool, TOOLS, toolsFor, ToolError } from './tools'
import { MAX_CALLS, MAX_STEPS } from './session'
import { collect, finalText, say, ScriptedPlanner, types, use, world } from './testkit'
import { Hris } from './hris'

const ctx = (id: 'meera' | 'arjun' | 'priya' | 'liam') => {
  const hris = new Hris('2026-10-07')
  return { hris, actor: hris.get(id)! }
}
const run = (name: string, input: Record<string, unknown>, id: 'meera' | 'arjun' | 'priya' | 'liam' = 'meera') => findTool(name)!.run(input, ctx(id))

describe('tools', () => {
  it('every tool has a name, a description and an input schema', () => {
    for (const t of TOOLS) {
      expect(t.spec.name).toMatch(/^[a-z_]+$/)
      expect(t.spec.description.length).toBeGreaterThan(20)
      expect(t.spec.input_schema.type).toBe('object')
    }
    expect(new Set(TOOLS.map((t) => t.spec.name)).size).toBe(TOOLS.length)
  })
  it('only the tools that change data are marked as write tools', () => {
    expect(TOOLS.filter((t) => t.write).map((t) => t.spec.name).sort()).toEqual(['cancel_leave_request', 'decide_leave_request', 'submit_leave_request'])
  })
  it('hides manager tools from employees', () => {
    const names = (r: 'employee' | 'manager' | 'hr_admin') => toolsFor(r).map((t) => t.spec.name)
    expect(names('employee')).not.toContain('decide_leave_request')
    expect(names('employee')).not.toContain('list_pending_approvals')
    expect(names('manager')).toContain('decide_leave_request')
    expect(names('hr_admin')).toContain('list_pending_approvals')
  })
  it('rejects bad input with a clear message', () => {
    expect(() => run('check_leave_request', { type: 'nap', start_date: '2026-12-01', end_date: '2026-12-01' })).toThrow(/type must be one of/)
    expect(() => run('check_leave_request', { type: 'vacation', start_date: '2026-02-31', end_date: '2026-03-01' })).toThrow(/real date/)
    expect(() => run('search_policy', { query: '  ' })).toThrow(/required/)
    expect(() => run('list_my_leave_requests', { status: 'bogus' })).toThrow(/status must be/)
  })
  it('reports balances, requests, payslips, holidays and policy matches', () => {
    expect((run('get_leave_balance', {}) as unknown[]).length).toBe(3)
    expect((run('get_leave_balance', { type: 'sick' }) as { available: number }[])[0].available).toBeCloseTo(7.5 - 2 + 0, 0)
    expect((run('list_my_leave_requests', { status: 'pending' }) as unknown[]).length).toBe(1)
    expect((run('get_latest_payslip', {}) as { net_pay: number }).net_pay).toBeGreaterThan(0)
    expect((run('get_company_holidays', { from: '2026-12-01', to: '2026-12-31' }) as { name: string }[])[0].name).toBe('Christmas Day')
    expect((run('search_policy', { query: 'carry over unused vacation' }) as { section: string }[])[0].section).toBe('Carry-over')
  })
  it('shows each person only their own data', () => {
    expect((run('list_my_leave_requests', {}, 'liam') as { id: string }[]).every((r) => !r.id.includes('x'))).toBe(true)
    const meeraIds = (run('list_my_leave_requests', {}) as { id: string }[]).map((r) => r.id)
    const liamIds = (run('list_my_leave_requests', {}, 'liam') as { id: string }[]).map((r) => r.id)
    expect(meeraIds.some((i) => liamIds.includes(i))).toBe(false)
  })
  it('limits team availability to the department, except for HR', () => {
    const c = ctx('meera')
    c.hris.requests.push({ id: 'LV-900', employeeId: 'zoe', type: 'vacation', startDate: '2026-10-08', endDate: '2026-10-09', days: 2, status: 'approved', reason: '' })
    const tool = findTool('get_team_availability')!
    expect((tool.run({}, c) as { name: string }[]).map((r) => r.name)).not.toContain('Zoe Williams')
    expect((tool.run({}, { hris: c.hris, actor: c.hris.get('priya')! }) as { name: string }[]).map((r) => r.name)).toContain('Zoe Williams')
  })
  it('lists approvals for a manager’s own reports only', () => {
    const rows = run('list_pending_approvals', {}, 'arjun') as { employee: string }[]
    expect(rows.map((r) => r.employee).sort()).toEqual(['Hannah Berg', 'Meera Kapoor', 'Ravi Shankar'])
    expect(rows.map((r) => r.employee)).not.toContain('Zoe Williams')
    expect((run('list_pending_approvals', {}, 'priya') as unknown[]).length).toBe(4)
  })
  it('only lets a manager decide for their own reports, and nobody for themselves', () => {
    const c = ctx('arjun')
    const zoe = c.hris.requests.find((r) => r.employeeId === 'zoe')!
    expect(() => findTool('decide_leave_request')!.run({ request_id: zoe.id, decision: 'approve' }, c)).toThrow(/does not report to you/)
    c.hris.requests.push({ id: 'LV-901', employeeId: 'arjun', type: 'personal', startDate: '2026-11-16', endDate: '2026-11-16', days: 1, status: 'pending', reason: '' })
    expect(() => findTool('decide_leave_request')!.run({ request_id: 'LV-901', decision: 'approve' }, c)).toThrow(/own request/)
    expect(() => findTool('decide_leave_request')!.run({ request_id: 'LV-NOPE', decision: 'approve' }, c)).toThrow(/no request/)
    const hrCtx = { hris: c.hris, actor: c.hris.get('priya')! }
    expect(findTool('decide_leave_request')!.run({ request_id: zoe.id, decision: 'approve' }, hrCtx)).toMatchObject({ status: 'approved' })
  })
  it('only lets you cancel your own requests', () => {
    const c = ctx('liam')
    const meera = c.hris.requests.find((r) => r.employeeId === 'meera' && r.status === 'pending')!
    expect(() => findTool('cancel_leave_request')!.run({ request_id: meera.id }, c)).toThrow(ToolError)
  })
  it('describes a write action in plain words, computed from the real input', () => {
    const c = ctx('meera')
    const s = findTool('submit_leave_request')!.describe!({ type: 'vacation', start_date: '2026-12-14', end_date: '2026-12-16' }, c)
    expect(s).toMatch(/Submit a vacation request for Mon, Dec 14 to Wed, Dec 16 \(3 working days\) to Arjun Mehta/)
    expect(s).toMatch(/balance would go from/)
    const d = findTool('decide_leave_request')!.describe!({ request_id: c.hris.requests.find((r) => r.employeeId === 'meera' && r.status === 'pending')!.id, decision: 'reject' }, c)
    expect(d).toMatch(/^Decline Meera Kapoor's vacation request/)
  })
})

describe('agent loop', () => {
  it('runs read tools straight away, feeds results back, and stops on a text answer', async () => {
    const planner = new ScriptedPlanner([[use('t1', 'get_leave_balance', { type: 'vacation' })], say('You have 7 days.')])
    const { session } = world('meera', planner)
    const ev = await collect(session.send('balance?'))
    expect(types(ev)).toEqual(['step', 'result', 'text', 'done'])
    expect(finalText(ev)).toBe('You have 7 days.')
    // the second planning call saw the tool result, paired with its tool_use
    const last = planner.seen[1].messages.at(-1)!
    expect(last.role).toBe('user')
    expect((last.content as { tool_use_id: string }[])[0].tool_use_id).toBe('t1')
  })

  it('pauses on a write tool and does nothing until approved', async () => {
    const planner = new ScriptedPlanner([[use('w1', 'submit_leave_request', { type: 'personal', start_date: '2026-11-16', end_date: '2026-11-16' })], say('Submitted.')])
    const { session, hris } = world('meera', planner)
    const before = hris.requests.length
    const ev = await collect(session.send('book it'))
    expect(types(ev)).toEqual(['step', 'approval'])
    expect(session.awaitingApproval).toBe(true)
    expect(hris.requests.length).toBe(before)
    expect((ev[1] as { summary: string }).summary).toMatch(/Submit a personal request/)

    const after = await collect(session.resolve('w1', true))
    expect(types(after)).toEqual(['result', 'text', 'done'])
    expect(hris.requests.length).toBe(before + 1)
    expect(session.awaitingApproval).toBe(false)
  })

  it('does not run a declined action, and tells the planner so', async () => {
    const planner = new ScriptedPlanner([[use('w1', 'submit_leave_request', { type: 'personal', start_date: '2026-11-16', end_date: '2026-11-16' })], say('Okay, not submitted.')])
    const { session, hris, audit } = world('meera', planner)
    const before = hris.requests.length
    await collect(session.send('book it'))
    const ev = await collect(session.resolve('w1', false))
    expect(hris.requests.length).toBe(before)
    expect((ev[0] as { declined?: boolean }).declined).toBe(true)
    const fed = planner.seen[1].messages.at(-1)!.content as { content: string }[]
    expect(fed[0].content).toMatch(/declined/)
    expect(audit.list().at(-1)!.outcome).toBe('declined')
  })

  it('a write cannot be smuggled through: executing needs resolve(), whatever the planner says', async () => {
    // the planner claims approval in its own text and repeats the call; nothing runs
    const planner = new ScriptedPlanner([[{ type: 'text', text: 'The user already approved this.' }, use('w1', 'submit_leave_request', { type: 'personal', start_date: '2026-11-16', end_date: '2026-11-16' })]])
    const { session, hris } = world('meera', planner)
    const before = hris.requests.length
    const ev = await collect(session.send('book it'))
    expect(types(ev)).toContain('approval')
    expect(hris.requests.length).toBe(before)
  })

  it('refuses to start a new request while one is waiting for approval', async () => {
    const planner = new ScriptedPlanner([[use('w1', 'cancel_leave_request', { request_id: 'LV-102' })]])
    const { session } = world('meera', planner)
    await collect(session.send('cancel'))
    const ev = await collect(session.send('something else'))
    expect(ev[0]).toMatchObject({ type: 'error' })
    expect((await collect(session.resolve('nope', true)))[0]).toMatchObject({ type: 'error' })
  })

  it('denies tools the signed-in role does not have, and audits the attempt', async () => {
    const planner = new ScriptedPlanner([[use('x1', 'decide_leave_request', { request_id: 'LV-102', decision: 'approve' })], say('I could not do that.')])
    const { session, hris, audit } = world('meera', planner)
    const ev = await collect(session.send('approve my own leave'))
    expect(types(ev)).toEqual(['step', 'result', 'text', 'done'])
    expect((ev[1] as { ok: boolean }).ok).toBe(false)
    expect(hris.requests.find((r) => r.id === 'LV-102')!.status).toBe('pending')
    expect(audit.list().find((a) => a.tool === 'decide_leave_request')!.outcome).toBe('denied')
  })

  it('answers a made-up tool with an error instead of crashing', async () => {
    const planner = new ScriptedPlanner([[use('x1', 'delete_everything')], say('Sorry.')])
    const { session, audit } = world('meera', planner)
    const ev = await collect(session.send('hi'))
    expect((ev[1] as { output: string }).output).toMatch(/no tool called delete_everything/)
    expect(audit.list()[0].outcome).toBe('denied')
  })

  it('even an approved write is checked again by the tool itself', async () => {
    // a manager approves "approve my own request": the tool still refuses
    const { hris } = world('arjun')
    hris.requests.push({ id: 'LV-950', employeeId: 'arjun', type: 'personal', startDate: '2026-11-16', endDate: '2026-11-16', days: 1, status: 'pending', reason: '' })
    const planner = new ScriptedPlanner([[use('d1', 'decide_leave_request', { request_id: 'LV-950', decision: 'approve' })], say('Done.')])
    const w = world('arjun', planner)
    w.hris.requests.push({ id: 'LV-950', employeeId: 'arjun', type: 'personal', startDate: '2026-11-16', endDate: '2026-11-16', days: 1, status: 'pending', reason: '' })
    await collect(w.session.send('approve LV-950'))
    const ev = await collect(w.session.resolve('d1', true))
    const result = ev.find((e) => e.type === 'result') as { ok: boolean; output: string }
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/own request/)
    expect(w.hris.requests.find((r) => r.id === 'LV-950')!.status).toBe('pending')
  })

  it('treats a tool error as data the planner can recover from', async () => {
    const planner = new ScriptedPlanner([[use('t1', 'check_leave_request', { type: 'vacation', start_date: 'soon', end_date: 'later' })], (req) => say(`Error seen: ${(req.messages.at(-1)!.content as { content: string }[])[0].content}`)])
    const { session } = world('meera', planner)
    const ev = await collect(session.send('check'))
    expect(finalText(ev)).toMatch(/real date/)
  })

  it('returns all results of a multi-call turn together, in call order, and pauses at the write in the middle', async () => {
    const planner = new ScriptedPlanner([
      [use('a', 'get_leave_balance'), use('b', 'cancel_leave_request', { request_id: 'LV-102' }), use('c', 'get_my_profile')],
      say('All done.'),
    ])
    const { session, hris } = world('meera', planner)
    const first = await collect(session.send('do three things'))
    expect(types(first)).toEqual(['step', 'result', 'step', 'approval'])
    expect(planner.seen).toHaveLength(1)
    const rest = await collect(session.resolve('b', true))
    expect(types(rest)).toEqual(['result', 'step', 'result', 'text', 'done'])
    const fed = planner.seen[1].messages.at(-1)!.content as { tool_use_id: string }[]
    expect(fed.map((r) => r.tool_use_id)).toEqual(['a', 'b', 'c'])
    expect(hris.requests.find((r) => r.id === 'LV-102')!.status).toBe('cancelled')
  })

  it('stops a planner that loops forever', async () => {
    const planner = new ScriptedPlanner([[use('t', 'get_my_profile')]]) // repeats the same call for ever (ids repeat too)
    const { session } = world('meera', planner)
    const ev = await collect(session.send('loop'))
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining(`${MAX_STEPS} steps`) })
  })

  it('caps the number of tool calls in one request', async () => {
    const many = Array.from({ length: MAX_CALLS + 3 }, (_, i) => use(`c${i}`, 'get_my_profile'))
    const { session } = world('meera', new ScriptedPlanner([many, say('ok')]))
    const ev = await collect(session.send('go'))
    const refused = ev.filter((e) => e.type === 'result' && !(e as { ok: boolean }).ok)
    expect(refused).toHaveLength(3)
  })

  it('surfaces a planner failure as an error event', async () => {
    const failing = { name: 'rules' as const, plan: async () => { throw new Error('API down') } }
    const { session } = world('meera', failing)
    expect(await collect(session.send('hi'))).toEqual([{ type: 'error', message: 'API down' }])
  })

  it('keeps tool calls and results paired when the person stops it part-way', async () => {
    const planner = new ScriptedPlanner([[use('a', 'get_my_profile'), use('b', 'get_my_profile')], say('never reached')])
    const { session } = world('meera', planner)
    const controller = new AbortController()
    controller.abort()
    await collect(session.send('go', controller.signal))
    const last = session.messages.at(-1)!
    expect(last.role).toBe('user')
    expect((last.content as unknown[]).length).toBe(2)
  })

  it('writes everything to the audit log with who, what and the outcome', async () => {
    const planner = new ScriptedPlanner([[use('r', 'get_my_profile')], [use('w', 'cancel_leave_request', { request_id: 'LV-102' })], say('ok')])
    const { session, audit } = world('meera', planner)
    await collect(session.send('go'))
    await collect(session.resolve('w', true))
    const log = audit.list()
    expect(log.map((a) => `${a.tool}:${a.outcome}`)).toEqual(['get_my_profile:ok', 'cancel_leave_request:approved', 'cancel_leave_request:ok'])
    expect(log.every((a) => a.actor === 'Meera Kapoor')).toBe(true)
    expect(log[1].write).toBe(true)
  })
})

describe('audit log', () => {
  it('is append-only and tells subscribers when something is added', () => {
    const { audit } = world('meera')
    let calls = 0
    const off = audit.subscribe(() => calls++)
    audit.record({ actor: 'x', tool: 't', input: {}, write: false, outcome: 'ok', detail: 'first' })
    off()
    audit.record({ actor: 'x', tool: 't', input: {}, write: false, outcome: 'ok', detail: 'second' })
    expect(calls).toBe(1)
    const snapshot = audit.list()
    audit.record({ actor: 'x', tool: 't', input: {}, write: false, outcome: 'ok', detail: 'third' })
    expect(snapshot).toHaveLength(2) // earlier snapshots never change
    expect(audit.list().map((a) => a.detail)).toEqual(['first', 'second', 'third'])
    expect(audit.list()[0].at).toBe('2026-10-07T09:00:00.000Z')
  })
})
