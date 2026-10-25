import { defineConfig } from '@playwright/test';

// E2E tests run the real built app (backend + frontend/dist) against a disposable local PostgreSQL.
// Required: TEST_DATABASE_URL. See README "Testing".
const port = 5091;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'node ../backend/dist/server.js',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      NODE_ENV: 'development',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      OPERATOR_LOGIN_PASSWORD: process.env.E2E_OPERATOR_PASSWORD ?? 'e2e-local-operator-password',
      SESSION_SECRET: 'e2e-session-secret-only-for-local-tests-0123456789',
      ESP32_API_KEY: 'e2e-device-key',
    },
  },
});
