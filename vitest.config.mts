import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Sets DATABASE_URL to a temporary database. Tests never open data/waypoint.db.
    globalSetup: ['tests/setup/db-env.ts'],
    // Live tests call Claude and cost money or quota. They run only when asked.
    exclude: process.env.WAYPOINT_LIVE ? [] : ['tests/**/*.live.test.ts'],
    // Test-only values, so modules that call env() load in unit tests.
    env: {
      WAYPOINT_SECRET_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
    },
  },
});
