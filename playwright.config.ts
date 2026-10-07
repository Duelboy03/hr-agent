import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4176', channel: 'chrome', viewport: { width: 1440, height: 860 } },
  webServer: {
    command: 'npm run build -w @hr-agent/web && npm exec -w @hr-agent/web -- vite preview --port 4176 --strictPort',
    url: 'http://localhost:4176',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
