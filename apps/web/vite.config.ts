import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { licenseInputs } from './build/license-inputs.ts';

// VITE_API_URL is baked in at build time. Production defaults to /api; explicit dev/E2E origins remain supported.
export default defineConfig({
  plugins: [react(), tailwindcss(), licenseInputs()],
  worker: { plugins: () => [licenseInputs()] },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { sourcemap: true },
});
