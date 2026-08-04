import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildPlugin } from './scripts/buildPlugin';

export default defineConfig({
  plugins: [react(), ...buildPlugin()],
});
