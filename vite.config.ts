import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5199 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
} as any);
