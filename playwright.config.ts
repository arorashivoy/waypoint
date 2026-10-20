import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { BASE_URL, PORT, SCRATCH } from './tests/e2e/setup/accounts';

/**
 * Device smoke tests: 6 profiles, one app on port 3150 with a scratch database.
 * On the Raspberry Pi the iPhone and iPad profiles run in WebKit. In the cloud, WAYPOINT_E2E_CHROMIUM_ONLY=1
 * runs all 6 in Chromium with the viewport, touch and user agent of the device.
 */
const chromiumOnly = process.env.WAYPOINT_E2E_CHROMIUM_ONLY === '1';

type Device = (typeof devices)[string];
const profile = (device: Device): Device => (chromiumOnly ? { ...device, defaultBrowserType: 'chromium' } : device);

// The iPad Pro 12.9 in portrait: the descriptor list has no 12.9, so this takes the iPad Pro 11 and sets the larger screen.
const ipadPro = { ...devices['iPad Pro 11'], viewport: { width: 1024, height: 1366 }, screen: { width: 1024, height: 1366 } };

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: join(SCRATCH, 'results'),
  globalSetup: './tests/e2e/setup/global-setup.ts',
  // One app and one database serve all projects. The tests run one at a time, so a slow Raspberry Pi never
  // compiles a page while a test waits for it.
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: BASE_URL, trace: 'off', screenshot: 'off' },
  projects: [
    { name: 'iphone-15', use: profile(devices['iPhone 15']) },
    { name: 'pixel-7', use: profile(devices['Pixel 7']) },
    { name: 'ipad-portrait', use: profile(devices['iPad (gen 7)']) },
    { name: 'ipad-landscape', use: profile(devices['iPad (gen 7) landscape']) },
    { name: 'ipad-pro', use: profile(ipadPro) },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'bash tests/e2e/setup/start.sh',
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: `file:${join(SCRATCH, 'e2e.db')}`,
      WAYPOINT_SECRET_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
      WAYPOINT_USERS_DIR: join(SCRATCH, 'users'),
      WAYPOINT_PUBLIC_URL: BASE_URL,
      // Claude is off: no key and no CLI.
      WAYPOINT_CLAUDE_BIN: '/nonexistent/claude',
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      // The admin has a base CV and no LaTeX source, so a build gives the base CV and needs no LaTeX engine.
      RESUME_PDF: join(process.cwd(), 'tests/e2e/fixtures/base-cv.pdf'),
      RESUME_TEX: '',
      LOG_LEVEL: 'warn',
    },
  },
});
