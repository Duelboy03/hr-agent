import { describe, expect, it } from 'vitest'
import { addDays, businessDays, isDate, overlaps, parseDates } from './dates'
import { TODAY } from './testkit'

const p = (s: string) => parseDates(s, TODAY)

describe('date helpers', () => {
  it('validates real dates only', () => {
    expect(isDate('2026-02-28')).toBe(true)
    expect(isDate('2026-02-30')).toBe(false)
    expect(isDate('tomorrow')).toBe(false)
    expect(isDate(20260228)).toBe(false)
  })
  it('counts working days, skipping weekends and holidays', () => {
    expect(businessDays('2026-10-05', '2026-10-11')).toBe(5)
    expect(businessDays('2026-10-05', '2026-10-09', new Set(['2026-10-07']))).toBe(4)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(overlaps('2026-10-05', '2026-10-07', '2026-10-07', '2026-10-09')).toBe(true)
    expect(overlaps('2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09')).toBe(false)
  })
})

describe('understanding dates in a request (today is Wednesday 7 Oct 2026)', () => {
  it('reads relative days', () => {
    expect(p('take tomorrow off')).toEqual({ start: '2026-10-08', end: '2026-10-08' })
    expect(p('off today')).toEqual({ start: TODAY, end: TODAY })
  })
  it('reads weekdays as the next one coming, never today', () => {
    expect(p('next Friday')).toEqual({ start: '2026-10-09', end: '2026-10-09' })
    expect(p('Wednesday')).toEqual({ start: '2026-10-14', end: '2026-10-14' })
  })
  it('reads a range of weekdays in the order written', () => {
    expect(p('from next Monday to Wednesday')).toEqual({ start: '2026-10-12', end: '2026-10-14' })
  })
  it('reads month names in both orders, and rolls past dates into next year', () => {
    expect(p('from Dec 14 to Dec 18')).toEqual({ start: '2026-12-14', end: '2026-12-18' })
    expect(p('on 22 December')).toEqual({ start: '2026-12-22', end: '2026-12-22' })
    expect(p('the 3rd of November')).toEqual({ start: '2026-11-03', end: '2026-11-03' })
    expect(p('Oct 2')).toEqual({ start: '2027-10-02', end: '2027-10-02' })
  })
  it('reads ISO dates', () => {
    expect(p('2026-12-22 to 2026-12-24')).toEqual({ start: '2026-12-22', end: '2026-12-24' })
  })
  it('reads "next week" as Monday to Friday', () => {
    expect(p('take next week off')).toMatchObject({ start: '2026-10-12', end: '2026-10-16' })
  })
  it('counts working days from a start date', () => {
    expect(p('for 3 days starting Monday')).toMatchObject({ start: '2026-10-12', end: '2026-10-14' })
    expect(p('for 3 days starting Thursday')).toMatchObject({ start: '2026-10-08', end: '2026-10-12' }) // skips the weekend
  })
  it('returns nothing when there is no date, and ignores impossible ones', () => {
    expect(p('I want some time off')).toEqual({})
    expect(p('2026-02-31')).toEqual({})
    expect(p('may I take a break')).toEqual({})
  })
})
