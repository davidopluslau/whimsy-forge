import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` has no Functions runtime; run `npm run dev:pages` alongside it for the API.
    proxy: { '/api': 'http://localhost:8788' },
  },
  // three.js alone is close to 1 MB; it is already split out of the entry chunk by route.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
});
