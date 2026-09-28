import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host: true -> reachable from phones on the same Wi-Fi (invite links point here).
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 5173 },
});
