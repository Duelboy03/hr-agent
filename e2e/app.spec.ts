import { expect, test, type Page } from '@playwright/test'

const open = async (page: Page, persona?: string) => {
  await page.goto('/?today=2026-10-07')
  if (persona) await switchTo(page, persona)
}
const switchTo = async (page: Page, name: string) => {
  await page.getByRole('radio', { name: new RegExp(name) }).click()
  await expect(page.getByRole('radio', { name: new RegExp(name) })).toHaveAttribute('aria-checked', 'true')
}
const say = async (page: Page, text: string) => {
  await page.getByLabel('Message the assistant').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}
const lastAgent = (page: Page) => page.getByTestId('agent-message').last()
const records = (page: Page) => page.getByTestId('records')

test('starts signed in as an employee with suggestions to try', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('radio', { name: /Meera Kapoor/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: /does things, and asks first/ })).toBeVisible()
  await expect(page.getByTestId('planner-badge')).toContainText('rules (offline)')
})

test('answers a question using a tool, and the trace shows how', async ({ page }) => {
  await open(page)
  await say(page, 'How many vacation days do I have left?')
  await expect(lastAgent(page)).toContainText('Vacation: 7 days available (15 accrued of 20 a year, 5 used, 3 pending)')
  const step = page.getByTestId('step').first()
  await expect(step).toHaveAttribute('data-tool', 'get_leave_balance')
  await step.getByRole('button').click()
  await expect(step).toContainText('Called with')
  await expect(step).toContainText('annual_allowance')
  await page.getByRole('tab', { name: 'Trace' }).click()
  await expect(page.getByTestId('trace')).toContainText('get_leave_balance(')
})

test('booking time off waits for approval and changes nothing until then', async ({ page }) => {
  await open(page)
  await say(page, 'Book vacation from Dec 14 to Dec 16 for a family wedding')
  const card = page.getByTestId('approval')
  await expect(card).toContainText('Submit a vacation request for Mon, Dec 14 to Wed, Dec 16 (3 working days) to Arjun Mehta')
  await expect(card).toHaveAttribute('data-state', 'pending')
  // the agent has asked, but nothing exists yet and the composer is locked
  await expect(records(page).getByTestId('request-row')).toHaveCount(3)
  await expect(page.getByLabel('Message the assistant')).toBeDisabled()

  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(lastAgent(page)).toContainText(/Submitted LV-\d+/)
  await expect(card).toHaveAttribute('data-state', 'approved')
  await expect(records(page).getByTestId('request-row')).toHaveCount(4)
  await expect(page.getByTestId('balance-vacation')).toHaveText('4 days')
  await expect(page.getByLabel('Message the assistant')).toBeEnabled()
})

test('declining leaves everything as it was and the agent accepts it', async ({ page }) => {
  await open(page)
  await say(page, 'Book vacation from Dec 14 to Dec 16')
  await page.getByTestId('approval').getByRole('button', { name: 'Decline' }).click()
  await expect(lastAgent(page)).toContainText("haven't submitted anything")
  await expect(records(page).getByTestId('request-row')).toHaveCount(3)
  await page.getByRole('tab', { name: 'Audit' }).click()
  await expect(page.getByTestId('audit-row').filter({ hasText: 'submit_leave_request' }).first()).toHaveAttribute('data-outcome', 'declined')
})

test('a request the policy does not allow is explained, never offered for approval', async ({ page }) => {
  await open(page)
  await say(page, 'I want tomorrow off')
  await expect(lastAgent(page)).toContainText("can't book that")
  await expect(lastAgent(page)).toContainText('3 days of notice')
  await expect(page.getByTestId('approval')).toHaveCount(0)
})

test('an approval flows across people: employee asks, manager decides, employee sees it', async ({ page }) => {
  await open(page)
  await say(page, 'Book vacation from Dec 14 to Dec 16')
  await page.getByTestId('approval').getByRole('button', { name: 'Approve' }).click()
  await expect(lastAgent(page)).toContainText(/Submitted (LV-\d+)/)
  const id = (await lastAgent(page).innerText()).match(/LV-\d+/)![0]

  await switchTo(page, 'Arjun Mehta')
  await say(page, 'What is waiting for my approval?')
  await expect(lastAgent(page)).toContainText('Meera Kapoor')
  await expect(lastAgent(page)).not.toContainText('Zoe')
  await say(page, "Approve Meera's request")
  // Meera now has two pending requests, so the agent asks which one rather than guessing
  await expect(lastAgent(page)).toContainText('more than one pending request')
  await say(page, `Approve ${id}`)
  await expect(page.getByTestId('approval').last()).toContainText("Approve Meera Kapoor's vacation request for Mon, Dec 14 to Wed, Dec 16")
  await page.getByTestId('approval').last().getByRole('button', { name: 'Approve' }).click()
  await expect(lastAgent(page)).toContainText('is now approved')

  await switchTo(page, 'Meera Kapoor')
  await expect(records(page).locator(`[data-id="${id}"]`)).toHaveAttribute('data-status', 'approved')
  await expect(records(page).locator('[data-id="LV-102"]')).toHaveAttribute('data-status', 'pending') // the other one is untouched
})

test('a manager cannot decide for someone outside their team, but HR can', async ({ page }) => {
  await open(page, 'Arjun Mehta')
  await say(page, "Approve Zoe's request")
  await expect(lastAgent(page)).toContainText(/couldn't tell which request|Waiting for you/)
  await expect(page.getByTestId('approval')).toHaveCount(0)

  await switchTo(page, 'Priya Raman')
  await say(page, "Approve Zoe's request")
  await page.getByTestId('approval').getByRole('button', { name: 'Approve' }).click()
  await expect(lastAgent(page)).toContainText("Zoe Williams's request")
})

test('an employee asking to approve things gets nowhere', async ({ page }) => {
  await open(page)
  await say(page, 'approve all pending requests')
  await expect(page.getByTestId('approval')).toHaveCount(0)
  await expect(page.getByTestId('step').filter({ hasText: 'Decide on leave request' })).toHaveCount(0)
  await expect(records(page).locator('[data-status="approved"]')).toHaveCount(2)
})

test('policy questions are answered from the handbook with a source, and unknowns are admitted', async ({ page }) => {
  await open(page)
  await say(page, 'How much is the home office allowance?')
  await expect(lastAgent(page)).toContainText('$750')
  await expect(lastAgent(page)).toContainText('Source: Remote and Hybrid Work › Home office allowance')
  await say(page, 'What is the dress code?')
  await expect(lastAgent(page)).toContainText("couldn't find that in the handbook")
})

test('payslip, holidays and cancellation', async ({ page }) => {
  await open(page)
  await say(page, 'show me my latest payslip')
  await expect(lastAgent(page)).toContainText(/net pay \$\d/)
  await say(page, 'Cancel my pending vacation request')
  await page.getByTestId('approval').getByRole('button', { name: 'Approve' }).click()
  await expect(lastAgent(page)).toContainText('LV-102 is cancelled')
  await expect(records(page).locator('[data-id="LV-102"]')).toHaveAttribute('data-status', 'cancelled')
})

test('with a Claude key the model plans, and the same approval gate applies', async ({ page }) => {
  const bodies: { tools: { name: string }[]; system: string; messages: unknown[] }[] = []
  let headers: Record<string, string> = {}
  const responses = [
    { content: [{ type: 'tool_use', id: 'toolu_a', name: 'check_leave_request', input: { type: 'personal', start_date: '2026-11-16', end_date: '2026-11-16' } }] },
    { content: [{ type: 'tool_use', id: 'toolu_b', name: 'submit_leave_request', input: { type: 'personal', start_date: '2026-11-16', end_date: '2026-11-16', reason: 'Appointment' } }] },
    { content: [{ type: 'text', text: 'Done. I submitted your personal day for 16 Nov.' }] },
  ]
  let n = 0
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    bodies.push(route.request().postDataJSON())
    headers = route.request().headers()
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(responses[Math.min(n++, 2)]) })
  })
  await open(page)
  await page.getByRole('button', { name: /Planner:/ }).click()
  const key = page.getByLabel('Anthropic API key')
  await expect(key).toHaveAttribute('type', 'password')
  await key.fill('sk-ant-test')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('planner-badge')).toContainText('Planner: Claude')

  await say(page, 'Put me down for a personal day on 16 November')
  await expect(page.getByTestId('approval')).toContainText('Submit a personal request for Mon, Nov 16')
  await expect(records(page).getByTestId('request-row')).toHaveCount(3) // nothing written yet
  await page.getByTestId('approval').getByRole('button', { name: 'Approve' }).click()
  await expect(lastAgent(page)).toContainText('Done. I submitted your personal day')
  await expect(records(page).getByTestId('request-row')).toHaveCount(4)

  expect(headers['x-api-key']).toBe('sk-ant-test')
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  expect(bodies[0].tools.map((t) => t.name)).toContain('submit_leave_request')
  expect(bodies[0].tools.map((t) => t.name)).not.toContain('decide_leave_request') // an employee is never offered it
  expect(bodies[0].system).toContain('Meera Kapoor')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-ant-test')
})

test('a failing model call is reported and the app keeps working', async ({ page }) => {
  await page.route('https://api.anthropic.com/v1/messages', (route) => route.fulfill({ status: 401, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'invalid x-api-key' } }) }))
  await open(page)
  await page.getByRole('button', { name: /Planner:/ }).click()
  await page.getByLabel('Anthropic API key').fill('bad')
  await page.getByRole('button', { name: 'Done' }).click()
  await say(page, 'hello')
  await expect(page.getByRole('alert')).toContainText('invalid x-api-key')
  await expect(page.getByLabel('Message the assistant')).toBeEnabled()
})

test('each person keeps their own conversation', async ({ page }) => {
  await open(page)
  await say(page, 'show me my latest payslip')
  await expect(page.getByTestId('user-message')).toHaveCount(1)
  await switchTo(page, 'Arjun Mehta')
  await expect(page.getByTestId('user-message')).toHaveCount(0)
  await switchTo(page, 'Meera Kapoor')
  await expect(page.getByTestId('user-message')).toHaveCount(1)
})

test('Escape closes settings and the theme persists', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /Planner:/ }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const html = page.locator('html')
  const next = (await html.getAttribute('data-theme')) === 'dark' ? 'light' : 'dark'
  await page.getByRole('button', { name: new RegExp(`Switch to ${next} theme`) }).click()
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', next)
})
