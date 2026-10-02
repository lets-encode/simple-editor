import { defineConfig } from 'vite';

// `host: true` listens on all interfaces so phones and tablets on the same network can connect.
export default defineConfig({
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
