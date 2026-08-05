import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Kitchen-sink dev sandbox: `npm run demo` from the package root. Like the
// telemetry demo, it consumes the package by name (the workspace-linked
// dist/, built by predemo) — the same artifact consumers get — so kit edits
// need `npm run build` to show up, not just a save.
export default defineConfig({
  plugins: [react()],
});
