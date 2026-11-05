import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '8788';

// A throwaway Access stand-in for this run. Workers re-evaluate this file but inherit the
// environment, so the keys are generated once.
if (!process.env.E2E_ACCESS_PRIVATE_JWK) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.E2E_ACCESS_PRIVATE_JWK = JSON.stringify(privateKey.export({ format: 'jwk' }));
  process.env.E2E_ACCESS_JWKS = JSON.stringify({
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256' }],
  });
  process.env.E2E_ACCESS_TEAM_DOMAIN = 'e2e.cloudflareaccess.com';
  process.env.E2E_ACCESS_AUD = randomUUID();
}

// Software WebGL so the scene renders on machines without a GPU, such as CI.
const webgl = { launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list'], ['json', { outputFile: 'playwright-report.json' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...webgl } },
    { name: 'phone', use: { ...devices['Pixel 7'], ...webgl }, testMatch: /chair\.spec\.ts/ },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://localhost:${PORT}/`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      E2E_PORT: PORT,
      E2E_ACCESS_TEAM_DOMAIN: process.env.E2E_ACCESS_TEAM_DOMAIN!,
      E2E_ACCESS_AUD: process.env.E2E_ACCESS_AUD!,
      E2E_ACCESS_JWKS: process.env.E2E_ACCESS_JWKS!,
    },
  },
});
