import { defineConfig, devices } from '@playwright/test'
import { TEST_AUTHIFY_ORIGIN, TEST_SSO_S2S_SECRET } from './tests/fixtures/sso.js'

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The E2E API writes to this database (SSO users, tickets, RFQs). It must be a local
 * database whose name contains "test". server/.env is deliberately not read.
 */
function assertLocalTestDatabase(name, value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`[playwright] ${name} is not a valid PostgreSQL URL.`)
  }
  const database = url.pathname.replace(/^\//, '')
  if (!LOCAL_DB_HOSTS.has(url.hostname) || !/test/i.test(database)) {
    throw new Error(
      `[playwright] Refusing ${name} (host "${url.hostname}", database "${database}"). `
        + 'E2E tests only run against a local database whose name contains "test".',
    )
  }
  return value
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const apiURL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001'
const databaseUrl = assertLocalTestDatabase(
  'DATABASE_URL',
  process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test_db',
)
const directUrl = assertLocalTestDatabase('DIRECT_URL', process.env.DIRECT_URL || databaseUrl)

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['github'],
        ['list'],
      ]
    : [
        ['html', { open: 'on-failure', outputFolder: 'playwright-report' }],
        ['list'],
      ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'smoke-chromium',
      testMatch: /smoke\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'regression-chromium',
      testMatch: /regression\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testMatch: /e2e\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: /e2e\/.*\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /e2e\/.*\.spec\.js/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: 'npm run start:ci',
          cwd: '../server',
          url: `${apiURL}/api/health`,
          // A server already on the API port fails the run unless explicitly opted in;
          // tests/global-setup.js then still checks it holds the test SSO secret.
          reuseExistingServer: process.env.PLAYWRIGHT_REUSE_API_SERVER === '1',
          timeout: 120_000,
          env: {
            NODE_ENV: 'test',
            PORT: '3001',
            DATABASE_URL: databaseUrl,
            DIRECT_URL: directUrl,
            JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long!',
            CLIENT_URL: 'http://127.0.0.1:5173',
            RAZORPAY_KEY_ID: 'rzp_test_TESTID',
            RAZORPAY_KEY_SECRET: 'test_secret_TESTKEY',
            SSO_S2S_SECRET: TEST_SSO_S2S_SECRET,
            SSO_HANDOFF_ALLOWED_ORIGINS: TEST_AUTHIFY_ORIGIN,
          },
        },
        {
          command: 'npm run dev -- --host 127.0.0.1 --port 5173',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            VITE_BACKEND_URL: apiURL,
            // Same host as the SSO handoff so the session cookie is sent with API calls.
            VITE_API_BASE_URL: `${apiURL}/api`,
          },
        },
      ],
})
