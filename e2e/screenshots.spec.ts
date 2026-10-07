import { expect, test, type Page } from '@playwright/test'

// Run with: npm run screenshots
test.skip(!process.env.SCREENSHOTS, 'screenshot generation only')
test.use({ viewport: { width: 1440, height: 860 }, colorScheme: 'dark' })

const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/${name}.png` })
const say = async (page: Page, text: string) => {
  await page.getByLabel('Message the assistant').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('capture', async ({ page }) => {
  await page.goto('/?today=2026-10-07')
  await page.waitForTimeout(500)
  await shot(page, 'empty')

  await say(page, 'How many vacation days do I have left?')
  await expect(page.getByTestId('agent-message').last()).toContainText('Vacation')
  await page.getByTestId('step').first().getByRole('button').click()
  await say(page, 'Book vacation from Dec 14 to Dec 16 for a family wedding')
  await expect(page.getByTestId('approval')).toBeVisible()
  await page.waitForTimeout(400)
  await shot(page, 'approval')

  await page.getByTestId('approval').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByTestId('agent-message').last()).toContainText('Submitted')
  await say(page, 'approve all pending requests') // an employee has no approval tools
  await expect(page.getByTestId('agent-message').last()).toBeVisible()
  await page.getByRole('tab', { name: 'Trace' }).click()
  await page.waitForTimeout(400)
  await shot(page, 'trace')

  await page.getByRole('radio', { name: /Arjun Mehta/ }).click()
  await say(page, 'What is waiting for my approval?')
  await expect(page.getByTestId('agent-message').last()).toContainText('waiting')
  await say(page, 'Approve LV-102')
  await expect(page.getByTestId('approval').last()).toBeVisible()
  await page.getByRole('tab', { name: 'Records' }).click()
  await page.waitForTimeout(400)
  await shot(page, 'manager')

  await page.getByTestId('approval').last().getByRole('button', { name: 'Decline' }).click()
  await expect(page.getByTestId('agent-message').last()).toContainText("haven't changed anything")
  await page.getByRole('tab', { name: 'Audit' }).click()
  await page.waitForTimeout(400)
  await shot(page, 'audit')

  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.getByRole('tab', { name: 'Records' }).click()
  await page.waitForTimeout(500)
  await shot(page, 'light')
})
