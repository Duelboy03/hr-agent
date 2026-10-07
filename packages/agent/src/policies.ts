export interface PolicyDoc {
  id: string
  title: string
  sections: { heading: string; text: string }[]
}

export const POLICIES: PolicyDoc[] = [
  {
    id: 'time-off',
    title: 'Paid Time Off',
    sections: [
      { heading: 'Vacation allowance', text: 'Full-time employees receive 20 vacation days per calendar year, accrued monthly at one twelfth of the allowance. The maximum vacation balance is 30 days. A new hire starts accruing from the month after they join.' },
      { heading: 'Requesting time off', text: 'Vacation needs at least 3 working days of notice and personal days need 1 working day. Your manager approves or declines within 2 business days. You cannot book more days than you will have accrued by the first day of your leave.' },
      { heading: 'Carry-over', text: 'Up to 5 unused vacation days carry over into the next calendar year. Days above 5 expire on 31 December. Personal days do not carry over.' },
      { heading: 'Unpaid leave', text: 'Unpaid leave needs 7 days of notice and manager approval. Unpaid days reduce your pay for the period at your daily rate.' },
    ],
  },
  {
    id: 'sick-leave',
    title: 'Sick and Medical Leave',
    sections: [
      { heading: 'Sick leave allowance', text: 'Full-time employees receive 10 paid sick days a year, accrued monthly, with a maximum balance of 15 days. Sick leave can be used when you are ill, to attend medical appointments, and to care for a sick child, spouse or parent.' },
      { heading: "Doctor's notes", text: "A doctor's note is only required when you are away for more than 3 consecutive working days. Send it to HR, not to your manager." },
      { heading: 'Short-term disability', text: 'If you are unable to work for more than 14 days because of illness or surgery, short-term disability pays 60 percent of your base salary for up to 12 weeks.' },
    ],
  },
  {
    id: 'parental-leave',
    title: 'Parental Leave',
    sections: [
      { heading: 'How much leave you get', text: 'Birth parents receive 16 weeks of fully paid parental leave. Non-birth, adoptive and foster parents receive 12 weeks. Leave must be used within 12 months of the birth or placement, and is available from your first day of employment.' },
      { heading: 'Returning to work', text: 'Employees returning from parental leave can work 80 percent of their normal hours at 100 percent of their pay for the first 4 weeks.' },
    ],
  },
  {
    id: 'expenses',
    title: 'Expenses and Business Travel',
    sections: [
      { heading: 'Submitting expenses', text: 'Submit each claim within 30 days of the purchase, with an itemised receipt for anything over $25. Approved claims are paid with your next payroll, usually within 5 working days.' },
      { heading: 'Approvals', text: 'Up to $500 your manager approves. From $501 to $2,500 your manager and department director approve. Over $2,500 needs approval in advance from the finance director.' },
      { heading: 'Travel', text: 'Fly economy; flights over 6 hours may be premium economy. Hotels are capped at $250 a night in major cities. Meals are a $65 per diem for each full day of travel.' },
    ],
  },
  {
    id: 'remote-work',
    title: 'Remote and Hybrid Work',
    sections: [
      { heading: 'Home office allowance', text: 'Every employee gets a one-time $750 allowance to set up a home workspace, then $50 a month toward internet and phone for remote employees. Claim both as expenses.' },
      { heading: 'Working from another location', text: 'You can work from anywhere in your home country for up to 20 days a year without approval. Working from abroad for any amount of time needs HR approval first, asked at least 6 weeks ahead and limited to 30 days.' },
    ],
  },
  {
    id: 'payroll',
    title: 'Pay, Payroll and Timesheets',
    sections: [
      { heading: 'When you are paid', text: 'Most employees are paid every second Friday, 26 times a year. Leadership roles are paid monthly, on the last business day of the month. Pay is sent by direct deposit.' },
      { heading: 'Overtime', text: 'Overtime is paid at 1.5 times your hourly rate for hours over 40 in a Monday to Sunday work week, calculated for each week separately. Overtime must be approved by your manager before you work it.' },
    ],
  },
  {
    id: 'security',
    title: 'Information Security and Acceptable Use',
    sections: [
      { heading: 'Using AI tools', text: 'You may use the AI assistants on the approved list for work. Never paste confidential or restricted information, such as customer data, source code from private repositories or employee records, into public AI tools or any tool not on the approved list.' },
      { heading: 'Devices', text: 'Report a lost or stolen device to the IT service desk within 1 hour of noticing, day or night. IT can lock and wipe it remotely.' },
    ],
  },
]

const STOP = new Set('a an and are as at be by can do does for from get how i if in is it me my of on or our so than that the their there they this to up was we what when where which who why will with would you your'.split(' '))
const toks = (s: string) => (s.toLowerCase().replace(/401\s*\(k\)/g, '401k').match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w))

export interface PolicyHit {
  doc: string
  title: string
  section: string
  text: string
  score: number
  /** distinct question words found in the section, and their share of all question words */
  matched: number
  coverage: number
}

/** A compact BM25 over policy sections. The PolicyPilot project is the full neural version of this. */
export function searchPolicies(query: string, k = 3, docs: PolicyDoc[] = POLICIES): PolicyHit[] {
  const items = docs.flatMap((d) => d.sections.map((s) => ({ d, s, tokens: [...toks(s.heading), ...toks(s.heading), ...toks(s.text)] })))
  const q = [...new Set(toks(query))]
  if (q.length === 0) return []
  const avg = items.reduce((a, i) => a + i.tokens.length, 0) / items.length
  const df = new Map<string, number>()
  for (const it of items) for (const t of new Set(it.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const scored = items.map((it) => {
    let score = 0
    let matched = 0
    for (const t of q) {
      const f = it.tokens.filter((x) => x === t).length
      if (!f) continue
      matched++
      const idf = Math.log(1 + (items.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
      score += idf * ((f * 2.5) / (f + 1.5 * (0.25 + (0.75 * it.tokens.length) / avg)))
    }
    return { doc: it.d.id, title: it.d.title, section: it.s.heading, text: it.s.text, score, matched, coverage: matched / q.length }
  })
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k)
}
