import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing ../deployment.json, ../abi and ../agent/stateMachine.ts from the project root
    fs: { allow: [".."] },
  },
});
