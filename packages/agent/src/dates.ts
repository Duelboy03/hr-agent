export type ISODate = string
const DAY = 86_400_000

const parse = (d: ISODate) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) throw new Error(`Invalid date: ${d}`)
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  if (fmt(t) !== d) throw new Error(`Invalid date: ${d}`)
  return t
}
const fmt = (t: number): ISODate => new Date(t).toISOString().slice(0, 10)

export const isDate = (s: unknown): s is ISODate => {
  if (typeof s !== 'string') return false
  try {
    parse(s)
    return true
  } catch {
    return false
  }
}
export const addDays = (d: ISODate, n: number): ISODate => fmt(parse(d) + n * DAY)
export const dow = (d: ISODate): number => new Date(parse(d)).getUTCDay()
export const isWeekend = (d: ISODate) => dow(d) === 0 || dow(d) === 6
export const cmp = (a: ISODate, b: ISODate) => parse(a) - parse(b)
export const year = (d: ISODate) => +d.slice(0, 4)

export function businessDays(start: ISODate, end: ISODate, holidays: ReadonlySet<ISODate> = new Set()): number {
  let n = 0
  for (let t = parse(start); t <= parse(end); t += DAY) {
    const d = fmt(t)
    if (!isWeekend(d) && !holidays.has(d)) n++
  }
  return n
}

export const overlaps = (aS: ISODate, aE: ISODate, bS: ISODate, bE: ISODate) => parse(aS) <= parse(bE) && parse(bS) <= parse(aE)

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** next occurrence of a weekday strictly after `from` */
const nextWeekday = (from: ISODate, w: number) => addDays(from, ((w - dow(from) + 6) % 7) + 1)

export interface ParsedDates {
  start?: ISODate
  end?: ISODate
  /** how the dates were understood, for echoing back to the user */
  note?: string
}

/**
 * Understands the date phrases people actually use when asking for time off:
 * "tomorrow", "next Friday", "from Dec 14 to Dec 18", "22 December", "2026-12-22",
 * "next week", "Monday to Wednesday", "for 3 days starting Monday".
 * It is deliberately conservative: when it cannot tell, it returns nothing and the agent asks.
 */
export function parseDates(text: string, today: ISODate): ParsedDates {
  const t = text.toLowerCase()
  const found: ISODate[] = []
  const y = year(today)

  const push = (d: ISODate | null) => d && found.push(d)
  const dateOf = (month: number, day: number): ISODate | null => {
    let cand = `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!isDate(cand)) return null
    if (cmp(cand, today) < 0) cand = `${y + 1}-${cand.slice(5)}` // a past date means next year
    return isDate(cand) ? cand : null
  }

  // everything is collected with its position so that "from X to Y" keeps its order
  const hits: { at: number; d: ISODate }[] = []
  const add = (at: number, d: ISODate | null) => d && hits.push({ at, d })

  for (const m of t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) add(m.index!, isDate(m[1]) ? m[1] : null)
  const monthRe = MONTHS.map((x) => `${x}[a-z]*`).join('|')
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})\\b`, 'g'))) add(m.index!, dateOf(MONTHS.indexOf(m[2].slice(0, 3)), +m[1]))
  for (const m of t.matchAll(new RegExp(`\\b(${monthRe})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))) add(m.index!, dateOf(MONTHS.indexOf(m[1].slice(0, 3)), +m[2]))
  if (/\btoday\b/.test(t)) add(t.indexOf('today'), today)
  if (/\btomorrow\b/.test(t)) add(t.indexOf('tomorrow'), addDays(today, 1))
  for (const m of t.matchAll(/\b(next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) {
    const w = WEEKDAYS.indexOf(m[2])
    add(m.index!, nextWeekday(today, w)) // "Friday", "this Friday" and "next Friday" all mean the next one coming
  }
  hits.sort((a, b) => a.at - b.at)
  for (const h of hits) if (!found.includes(h.d)) push(h.d)

  // "next week" is the following Monday to Friday
  if (/\bnext week\b/.test(t) && found.length === 0) {
    const mon = nextWeekday(today, 1)
    return { start: mon, end: addDays(mon, 4), note: 'next week, Monday to Friday' }
  }

  const days = /\bfor\s+(\d{1,2}|a|one|two|three|four|five)\s+(?:working\s+)?days?\b/.exec(t)
  const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 }
  const n = days ? (words[days[1]] ?? +days[1]) : undefined

  if (found.length >= 2) return { start: found[0], end: found[1] }
  if (found.length === 1 && n) {
    // count working days from the start date
    let end = found[0]
    let left = n - 1
    while (left > 0) {
      end = addDays(end, 1)
      if (!isWeekend(end)) left--
    }
    return { start: found[0], end, note: `${n} working day${n === 1 ? '' : 's'} from the start` }
  }
  if (found.length === 1) return { start: found[0], end: found[0] }
  return {}
}
