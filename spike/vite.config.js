import { defineConfig } from 'vite';

// `host: true` listens on all interfaces so phones and tablets on the same network can connect.
// `fs.allow` lets the dev server serve the repo's `fixtures/` (MEI files and their facsimile images).
export default defineConfig({
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
  preview: { host: true, port: 4173 },
});
