import { addDays, businessDays, cmp, dow, isWeekend, overlaps, year, type ISODate } from './dates'
import type { Role } from './types'

export type LeaveType = 'vacation' | 'sick' | 'personal' | 'unpaid'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface Employee {
  id: string
  name: string
  title: string
  department: string
  role: Role
  managerId: string | null
  hireDate: ISODate
  annualSalary: number
}

export interface LeaveRequest {
  id: string
  employeeId: string
  type: LeaveType
  startDate: ISODate
  endDate: ISODate
  days: number
  status: LeaveStatus
  reason: string
  /** text written by the employee: untrusted, may contain anything */
  decidedBy?: string
}

export interface Payslip {
  payDate: ISODate
  periodStart: ISODate
  periodEnd: ISODate
  gross: number
  taxes: number
  deductions: number
  net: number
}

export const ENTITLEMENT: Record<LeaveType, number> = { vacation: 20, sick: 10, personal: 3, unpaid: 0 }
const NOTICE: Record<LeaveType, number> = { vacation: 3, sick: 0, personal: 1, unpaid: 7 }

export interface Check {
  ok: boolean
  days: number
  errors: string[]
  warnings: string[]
  balanceAfter: number | null
}

/** A small in-memory stand-in for an HR system of record. The agent only ever talks to it through tools. */
export class Hris {
  employees: Employee[]
  requests: LeaveRequest[]
  holidays: Map<ISODate, string>
  private payslips = new Map<string, Payslip[]>()
  private seq = 100

  constructor(public today: ISODate) {
    const y = year(today)
    const E = (id: string, name: string, title: string, department: string, role: Role, managerId: string | null, hire: ISODate, salary: number): Employee => ({ id, name, title, department, role, managerId, hireDate: hire, annualSalary: salary })
    this.employees = [
      E('priya', 'Priya Raman', 'HR Director', 'People', 'hr_admin', null, '2019-03-04', 128_000),
      E('arjun', 'Arjun Mehta', 'Engineering Manager', 'Engineering', 'manager', null, '2020-08-17', 156_000),
      E('meera', 'Meera Kapoor', 'Software Engineer', 'Engineering', 'employee', 'arjun', '2022-06-06', 128_000),
      E('liam', 'Liam Chen', 'Software Engineer', 'Engineering', 'employee', 'arjun', '2023-01-09', 118_000),
      E('hannah', 'Hannah Berg', 'QA Engineer', 'Engineering', 'employee', 'arjun', '2023-09-18', 96_000),
      E('ravi', 'Ravi Shankar', 'Data Analyst', 'Engineering', 'employee', 'arjun', '2024-04-01', 92_000),
      E('daniel', 'Daniel Okafor', 'Sales Manager', 'Sales', 'manager', null, '2020-01-13', 112_000),
      E('zoe', 'Zoe Williams', 'Sales Representative', 'Sales', 'employee', 'daniel', '2023-03-06', 78_000),
    ]
    const fixed: [string, string][] = [['01-01', "New Year's Day"], ['01-19', 'Martin Luther King Jr. Day'], ['02-16', "Presidents' Day"], ['05-25', 'Memorial Day'], ['06-19', 'Juneteenth'], ['07-03', 'Independence Day (observed)'], ['09-07', 'Labor Day'], ['10-12', 'Columbus Day'], ['11-11', 'Veterans Day'], ['11-26', 'Thanksgiving'], ['12-25', 'Christmas Day']]
    this.holidays = new Map(fixed.flatMap(([md, n]) => [[`${y}-${md}`, n], [`${y + 1}-${md}`, n]] as [ISODate, string][]))

    const mon = (offset: number) => {
      let d = addDays(today, offset)
      while (isWeekend(d)) d = addDays(d, 1)
      return d
    }
    const seed = (employeeId: string, type: LeaveType, from: number, span: number, status: LeaveStatus, reason: string) => {
      const start = mon(from)
      let end = start
      for (let n = 1; n < span; n++) {
        end = addDays(end, 1)
        while (isWeekend(end)) end = addDays(end, 1)
      }
      this.requests.push({ id: `LV-${this.seq++}`, employeeId, type, startDate: start, endDate: end, days: businessDays(start, end, new Set(this.holidays.keys())), status, reason })
    }
    this.requests = []
    seed('meera', 'vacation', -60, 5, 'approved', 'Family trip')
    seed('meera', 'sick', -18, 2, 'approved', 'Flu')
    seed('meera', 'vacation', 30, 3, 'pending', 'Long weekend')
    seed('liam', 'vacation', 5, 4, 'approved', 'Visiting family')
    seed('hannah', 'personal', 9, 1, 'pending', 'Moving apartments')
    seed('ravi', 'vacation', 12, 3, 'pending', 'Short break')
    seed('zoe', 'vacation', 21, 5, 'pending', 'Wedding')
  }

  get = (id: string) => this.employees.find((e) => e.id === id)
  holidaySet = () => new Set(this.holidays.keys())
  reports = (managerId: string) => this.employees.filter((e) => e.managerId === managerId)
  isManagerOf = (managerId: string, employeeId: string) => this.get(employeeId)?.managerId === managerId

  /** Days accrued so far this year: one twelfth of the annual entitlement for each completed month. */
  accrued(employeeId: string, type: LeaveType, asOf: ISODate = this.today): number {
    const e = this.get(employeeId)!
    const y = year(asOf)
    const first = year(e.hireDate) < y ? 1 : +e.hireDate.slice(5, 7) + 1
    const months = Math.max(0, +asOf.slice(5, 7) - 1 - first + 1)
    return Math.round(((ENTITLEMENT[type] / 12) * months) * 100) / 100
  }

  balance(employeeId: string, type: LeaveType, asOf: ISODate = this.today) {
    const y = year(asOf)
    const mine = this.requests.filter((r) => r.employeeId === employeeId && r.type === type && year(r.startDate) === y)
    const used = mine.filter((r) => r.status === 'approved').reduce((a, r) => a + r.days, 0)
    const pending = mine.filter((r) => r.status === 'pending').reduce((a, r) => a + r.days, 0)
    const accrued = this.accrued(employeeId, type, asOf)
    return { type, accrued, used, pending, available: type === 'unpaid' ? Infinity : accrued - used - pending }
  }

  check(employeeId: string, type: LeaveType, start: ISODate, end: ISODate): Check {
    const errors: string[] = []
    const warnings: string[] = []
    if (cmp(end, start) < 0) return { ok: false, days: 0, errors: ['The end date is before the start date.'], warnings, balanceAfter: null }
    const days = businessDays(start, end, this.holidaySet())
    if (days === 0) errors.push('That range has no working days (weekends and company holidays do not count).')
    if (year(start) !== year(end)) errors.push('A request cannot span two calendar years.')
    const notice = (cmp(start, this.today) / 86_400_000)
    if (type !== 'sick' && notice < NOTICE[type]) errors.push(`${type[0].toUpperCase()}${type.slice(1)} leave needs ${NOTICE[type]} day${NOTICE[type] === 1 ? '' : 's'} of notice.`)
    const clash = this.requests.find((r) => r.employeeId === employeeId && (r.status === 'pending' || r.status === 'approved') && overlaps(start, end, r.startDate, r.endDate))
    if (clash) errors.push(`It overlaps ${clash.id} (${clash.startDate} to ${clash.endDate}, ${clash.status}).`)
    let balanceAfter: number | null = null
    if (type !== 'unpaid' && days > 0) {
      balanceAfter = this.balance(employeeId, type, start).available - days
      if (balanceAfter < 0) errors.push(`That would leave ${balanceAfter.toFixed(2).replace(/\.?0+$/, '')} ${type} days; the balance cannot go negative.`)
      else if (balanceAfter < 1) warnings.push('This uses almost all of the remaining balance.')
    }
    return { ok: errors.length === 0, days, errors, warnings, balanceAfter }
  }

  submit(employeeId: string, type: LeaveType, start: ISODate, end: ISODate, reason: string): LeaveRequest {
    const c = this.check(employeeId, type, start, end)
    if (!c.ok) throw new Error(c.errors[0])
    const r: LeaveRequest = { id: `LV-${this.seq++}`, employeeId, type, startDate: start, endDate: end, days: c.days, status: 'pending', reason: reason.slice(0, 300) }
    this.requests.push(r)
    return r
  }

  decide(requestId: string, action: 'approve' | 'reject' | 'cancel', by: string): LeaveRequest {
    const r = this.requests.find((x) => x.id === requestId)
    if (!r) throw new Error(`There is no request ${requestId}.`)
    if (action === 'cancel') {
      if (r.status !== 'pending' && !(r.status === 'approved' && cmp(r.startDate, this.today) > 0)) throw new Error(`${r.id} is ${r.status} and cannot be cancelled.`)
      r.status = 'cancelled'
    } else {
      if (r.status !== 'pending') throw new Error(`${r.id} is already ${r.status}.`)
      if (r.employeeId === by) throw new Error('You cannot decide your own request.')
      if (action === 'approve') {
        const after = this.balance(r.employeeId, r.type, r.startDate)
        // the request itself is pending, so it is already counted in `available`
        if (r.type !== 'unpaid' && after.available < 0) throw new Error('Approving would take the balance below zero.')
      }
      r.status = action === 'approve' ? 'approved' : 'rejected'
      r.decidedBy = by
    }
    return r
  }

  latestPayslip(employeeId: string): Payslip {
    return this.payslipsOf(employeeId)[0]
  }

  payslipsOf(employeeId: string): Payslip[] {
    let list = this.payslips.get(employeeId)
    if (!list) {
      const e = this.get(employeeId)!
      const gross = Math.round((e.annualSalary / 26) * 100) / 100
      list = Array.from({ length: 6 }, (_, i) => {
        const pay = addDays(this.today, -(((dow(this.today) - 5 + 7) % 7) + i * 14)) // the most recent Friday, then every two weeks back
        const taxes = Math.round(gross * (e.annualSalary > 120_000 ? 0.26 : 0.21) * 100) / 100
        const deductions = Math.round(gross * 0.09 * 100) / 100
        return { payDate: pay, periodStart: addDays(pay, -18), periodEnd: addDays(pay, -5), gross, taxes, deductions, net: Math.round((gross - taxes - deductions) * 100) / 100 }
      })
      this.payslips.set(employeeId, list)
    }
    return list
  }
}
