import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: 'dev/.env.local', override: false })
dotenv.config({ path: 'dev/.env', override: false })

const isCI = Boolean(process.env.CI)
const port = Number(process.env.PLAYWRIGHT_PORT || '3000')
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '') || `http://localhost:${port}`

const webServerCommand = `cross-env NODE_ENV=test NODE_OPTIONS=--no-deprecation PAYLOAD_CONFIG_PATH=./dev/payload.config.ts pnpm exec next start dev -p ${port}`

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    // Local: reuse a manually started `pnpm dev` when the admin URL is already up.
    reuseExistingServer: !isCI,
    url: `${baseURL}/admin`,
    timeout: 240_000,
  },
})
