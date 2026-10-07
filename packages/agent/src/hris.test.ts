import { describe, expect, it } from 'vitest'
import { Hris } from './hris'
import { TODAY } from './testkit'

const h = () => new Hris(TODAY)

describe('balances', () => {
  it('accrue one twelfth a month and subtract approved and pending days', () => {
    const b = h().balance('meera', 'vacation')
    expect(b.accrued).toBeCloseTo(15) // nine completed months of 20/12
    expect(b.used).toBe(5)
    expect(b.pending).toBe(3)
    expect(b.available).toBeCloseTo(7)
  })
  it('treat unpaid leave as unlimited', () => {
    expect(h().balance('meera', 'unpaid').available).toBe(Infinity)
  })
  it('start a mid-year hire from the month after they join', () => {
    const x = h()
    x.employees.find((e) => e.id === 'liam')!.hireDate = '2026-07-15'
    expect(x.accrued('liam', 'vacation')).toBeCloseTo((20 / 12) * 2) // Aug and Sep
  })
})

describe('checking a request', () => {
  it('accepts a normal request and reports the balance afterwards', () => {
    const c = h().check('meera', 'vacation', '2026-12-14', '2026-12-16')
    expect(c).toMatchObject({ ok: true, days: 3 })
    expect(c.balanceAfter).toBeCloseTo(7 + (20 / 12) * 2 - 3 + 0, 0) // accrual through December counts
  })
  it('refuses weekends-only, reversed ranges and year-spanning ranges', () => {
    expect(h().check('meera', 'vacation', '2026-10-17', '2026-10-18').errors[0]).toMatch(/no working days/)
    expect(h().check('meera', 'vacation', '2026-10-20', '2026-10-19').errors[0]).toMatch(/before the start/)
    expect(h().check('meera', 'unpaid', '2026-12-30', '2027-01-05').errors.join()).toMatch(/two calendar years/)
  })
  it('does not count company holidays', () => {
    expect(h().check('meera', 'vacation', '2026-12-24', '2026-12-28').days).toBe(2)
  })
  it('enforces notice for everything except sick leave', () => {
    expect(h().check('meera', 'vacation', '2026-10-08', '2026-10-08').errors.join()).toMatch(/3 days of notice/)
    expect(h().check('meera', 'sick', '2026-10-07', '2026-10-07').ok).toBe(true)
  })
  it('blocks overlaps with pending or approved requests', () => {
    const x = h()
    const mine = x.requests.find((r) => r.employeeId === 'meera' && r.status === 'pending')!
    expect(x.check('meera', 'vacation', mine.startDate, mine.endDate).errors.join()).toMatch(/overlaps LV-/)
  })
  it('blocks a request that would overdraw the balance', () => {
    expect(h().check('meera', 'vacation', '2026-10-19', '2026-11-13').errors.join()).toMatch(/cannot go negative/)
  })
})

describe('submitting and deciding', () => {
  it('submits, then lets the manager approve, and records who decided', () => {
    const x = h()
    const r = x.submit('meera', 'personal', '2026-11-16', '2026-11-16', 'Appointment')
    expect(r.status).toBe('pending')
    expect(x.decide(r.id, 'approve', 'arjun').status).toBe('approved')
    expect(x.requests.find((q) => q.id === r.id)!.decidedBy).toBe('arjun')
  })
  it('refuses to submit what check would refuse', () => {
    expect(() => h().submit('meera', 'vacation', '2026-10-08', '2026-10-08', '')).toThrow(/notice/)
  })
  it('never lets someone decide their own request or re-decide a decided one', () => {
    const x = h()
    const r = x.requests.find((q) => q.employeeId === 'meera' && q.status === 'pending')!
    expect(() => x.decide(r.id, 'approve', 'meera')).toThrow(/own request/)
    x.decide(r.id, 'reject', 'arjun')
    expect(() => x.decide(r.id, 'approve', 'arjun')).toThrow(/already rejected/)
  })
  it('cancels pending and future approved requests but not past ones', () => {
    const x = h()
    const past = x.requests.find((q) => q.employeeId === 'meera' && q.status === 'approved' && q.endDate < TODAY)!
    expect(() => x.decide(past.id, 'cancel', 'meera')).toThrow(/cannot be cancelled/)
    const pending = x.requests.find((q) => q.employeeId === 'meera' && q.status === 'pending')!
    expect(x.decide(pending.id, 'cancel', 'meera').status).toBe('cancelled')
  })
  it('truncates long free-text reasons', () => {
    expect(h().submit('meera', 'personal', '2026-11-16', '2026-11-16', 'x'.repeat(1000)).reason).toHaveLength(300)
  })
})

describe('payslips', () => {
  it('balance: gross minus taxes and deductions equals net', () => {
    for (const p of h().payslipsOf('meera')) expect(p.net).toBeCloseTo(p.gross - p.taxes - p.deductions, 2)
    expect(h().payslipsOf('meera')).toHaveLength(6)
  })
  it('are dated on Fridays, two weeks apart', () => {
    const [a, b] = h().payslipsOf('meera')
    expect(new Date(`${a.payDate}T00:00:00Z`).getUTCDay()).toBe(5)
    expect((Date.parse(a.payDate) - Date.parse(b.payDate)) / 86_400_000).toBe(14)
  })
})
