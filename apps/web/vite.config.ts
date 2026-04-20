import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

// Пути к SSL сертификатам
const certsDir = path.resolve(__dirname, '../../certs');
const certFile = path.join(certsDir, 'cert.pem');
const keyFile = path.join(certsDir, 'key.pem');
const pfxFile = path.join(certsDir, 'cert.pfx');

// Проверяем наличие сертификатов
let httpsConfig: any = false;
let isHttps = false;

if (fs.existsSync(pfxFile)) {
  isHttps = true;
  httpsConfig = {
    pfx: fs.readFileSync(pfxFile),
    passphrase: 'sava123',
  };
  console.log('  🔒 HTTPS включен (PFX сертификат)');
} else if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  isHttps = true;
  httpsConfig = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
  };
  console.log('  🔒 HTTPS включен (PEM сертификаты)');
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    https: httpsConfig,
    host: true, // Доступ с сети
    proxy: {
      '/api': {
        target: isHttps ? 'https://localhost:3001' : 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: isHttps ? 'https://localhost:3001' : 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: isHttps ? 'https://localhost:3001' : 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});