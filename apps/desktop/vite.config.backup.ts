import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

// Пути к SSL сертификатам
const certsDir = path.resolve(__dirname, '../../certs');
const certFile = path.join(certsDir, 'cert.pem');
const pfxFile = path.join(certsDir, 'cert.pfx');

// Проверяем наличие сертификатов
let httpsConfig: any = false;
if (fs.existsSync(pfxFile)) {
  httpsConfig = {
    pfx: fs.readFileSync(pfxFile),
    passphrase: 'sava123',
  };
  console.log('  🔒 HTTPS включен (PFX сертификат)');
} else if (fs.existsSync(certFile)) {
  const keyFile = path.join(certsDir, 'key.pem');
  if (fs.existsSync(keyFile)) {
    httpsConfig = {
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
    };
    console.log('  🔒 HTTPS включен (PEM сертификаты)');
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    https: httpsConfig,
    host: true, // Доступ с сети
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
