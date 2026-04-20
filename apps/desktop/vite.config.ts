import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import fs from 'fs';
import path from 'path';

// Пути к SSL сертификатам
const certsDir = path.resolve(__dirname, '../../certs');
const certFile = path.join(certsDir, 'cert.pem');
const keyFile = path.join(certsDir, 'key.pem');
const pfxFile = path.join(certsDir, 'cert.pfx');

// Проверяем наличие сертификатов
const isHttps = fs.existsSync(pfxFile) || (fs.existsSync(certFile) && fs.existsSync(keyFile));

let httpsConfig: any = false;
if (fs.existsSync(pfxFile)) {
  httpsConfig = {
    pfx: fs.readFileSync(pfxFile),
    passphrase: 'sava123',
  };
  console.log('  🔒 HTTPS включен (PFX сертификат)');
} else if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  httpsConfig = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
  };
  console.log('  🔒 HTTPS включен (PEM сертификаты)');
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      preload: {
        input: 'preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
    }),
  ],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    https: httpsConfig,
    host: true,
    proxy: isHttps ? {
      '/api': {
        target: 'https://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'https://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'https://localhost:3001',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    } : undefined,
  },
});
