import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },


    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
