import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@tauri-apps')) return 'tauri';
          if (id.includes('@tanstack')) return 'tanstack';
          if (
            id.includes('@base-ui') ||
            id.includes('@radix-ui') ||
            id.includes('lucide-react') ||
            id.includes('sonner') ||
            id.includes('next-themes')
          )
            return 'ui';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('scheduler')
          )
            return 'react';
        },
      },
    },
  },
});
