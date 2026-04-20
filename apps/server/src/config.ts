import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { initEncryption } from './encrypt';

dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

// ─── Автогенерация JWT_SECRET, если переменная не задана или используется dev-значение ───
const ENV_PATH = path.join(__dirname, '../.env');
const DEFAULT_DEV_SECRET = 'sava-dev-secret-change-in-production-abc123xyz789';

function getOrCreateJwtSecret(): string {
  let secret = process.env.JWT_SECRET;

  if (!secret || secret === DEFAULT_DEV_SECRET) {
    // Генерируем безопасный секрет
    secret = crypto.randomBytes(32).toString('hex');

    try {
      let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';

      if (envContent.includes('JWT_SECRET=')) {
        envContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${secret}`);
      } else {
        envContent += (envContent.endsWith('\n') ? '' : '\n') + `JWT_SECRET=${secret}\n`;
      }

      fs.writeFileSync(ENV_PATH, envContent, 'utf8');
      console.log('  🔑 JWT_SECRET сгенерирован и сохранён в .env');
    } catch (err) {
      console.error('  ⚠ Не удалось сохранить JWT_SECRET в .env:', err);
    }

    // Перезагружаем .env с новым секретом
    dotenv.config({ path: ENV_PATH, override: true });
  }

  return secret;
}

const jwtSecret = getOrCreateJwtSecret();

// Инициализируем шифрование сообщений, если задан ключ
if (process.env.ENCRYPTION_KEY) {
  initEncryption(process.env.ENCRYPTION_KEY);
  console.log('  🔒 Шифрование сообщений включено (AES-256-GCM)');
} else {
  console.warn('  ⚠ ENCRYPTION_KEY не задан — сообщения хранятся без шифрования. Для продакшена задайте 64-символьный hex-ключ.');
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  jwtSecret,
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : [
        'http://localhost:5173', 'https://localhost:5173',
        'http://localhost:3000', 'https://localhost:3000',
        'http://localhost:3001', 'https://localhost:3001',
        'http://localhost:3002', 'https://localhost:3002',
        'http://198.18.0.1:5173', 'https://198.18.0.1:5173',
        'http://198.18.0.1:3001', 'https://198.18.0.1:3001',
      ],
  uploadsDir: 'uploads',
  /** Minimum password length */
  minPasswordLength: 8,
  /** Maximum registrations allowed from the same IP (permanent, DB-level) */
  maxRegistrationsPerIp: Number(process.env.MAX_REGISTRATIONS_PER_IP) || 2,
  /** TURN server URL for WebRTC calls (e.g. turn:your-domain.com:3478) */
  turnUrl: process.env.TURN_URL || '',
  /** Shared secret for TURN server (coturn static-auth-secret) */
  turnSecret: process.env.TURN_SECRET || '',
  /** STUN server URLs */
  stunUrls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',').map(s => s.trim()).filter(Boolean),
};
