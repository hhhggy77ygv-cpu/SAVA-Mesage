import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import mime from 'mime-types';
import { config } from './config';
import { logToServer } from './logger';
import { prisma } from './db';
import authRoutes, { getAppSettings, updateAppSettings } from './routes/auth';
import userRoutes from './routes/users';
import chatRoutes from './routes/chats';
import messageRoutes from './routes/messages';
import storyRoutes from './routes/stories';
import friendRoutes from './routes/friends';
import statusRoutes from './routes/status';
import pollRoutes from './routes/polls';
import linkPreviewRoutes from './routes/linkpreview';
import { loadSettings } from './routes/admin';
import { setupSocket } from './socket';
import { authenticateToken, AuthRequest } from './middleware/auth';
import { decryptFileToBuffer, isEncryptionEnabled } from './encrypt';
import { UPLOADS_ROOT } from './shared';

const certsDir = path.join(__dirname, '../../certs');
const certFile = path.join(certsDir, 'cert.pem');
const keyFile = path.join(certsDir, 'key.pem');

const app = express();
let server;
const isHttps = fs.existsSync(certFile) && fs.existsSync(keyFile);

if (isHttps) {
  const httpsOptions = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
  };
  server = createHttpsServer(httpsOptions, app);
  console.log('  🔒 HTTPS включен');
} else {
  server = createServer(app);
  console.warn('  ⚠ HTTPS отключен (сертификаты не найдены)');
}

const io = new Server(server, {
  cors: {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

// Trust first proxy (Nginx) so req.ip returns real client IP from X-Forwarded-For
app.set('trust proxy', 1);

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '10mb' }));

// Serve uploads — decrypts encrypted files on the fly
app.use('/uploads', (req, res, next) => {
  // Security headers - allow media files to be displayed inline
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' blob: data:; media-src 'self' blob: data:; style-src 'unsafe-inline'");
  // Aggressive caching for immutable uploads (UUID filenames never change)
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

  // Resolve file path safely
  const urlPath = decodeURIComponent(req.path);
  if (urlPath.includes('..')) {
    res.status(400).end();
    return;
  }

  const filePath = path.resolve(UPLOADS_ROOT, urlPath.replace(/^\//, ''));
  if (!filePath.startsWith(UPLOADS_ROOT) || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }

  // Set Content-Type from extension
  const contentType = mime.lookup(filePath) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);

  // If encryption is enabled, try to decrypt
  if (isEncryptionEnabled()) {
    const decrypted = decryptFileToBuffer(filePath);
    if (decrypted) {
      res.setHeader('Content-Length', decrypted.length);
      res.end(decrypted);
      return;
    }
    // Decryption failed — file is likely unencrypted (legacy), fall through to static
  }

  // Serve unencrypted file as-is
  next();
}, express.static(UPLOADS_ROOT));

// Rate limiting for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // max 50 attempts per window (increased for normal usage)
  message: { error: 'Слишком много попыток, попробуйте через 15 минут' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter (200 req/min per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // increased from 100 to 200
  message: { error: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Global security headers ─────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.jsdelivr.net; media-src 'self' blob:; connect-src 'self' ws: wss: https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'"
  );
  next();
});

// API маршруты
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', apiLimiter, authenticateToken, userRoutes);
app.use('/api/chats', apiLimiter, authenticateToken, chatRoutes);
app.use('/api/messages', apiLimiter, authenticateToken, messageRoutes);
app.use('/api/stories', apiLimiter, authenticateToken, storyRoutes);
app.use('/api/friends', apiLimiter, authenticateToken, friendRoutes);
app.use('/api/me', apiLimiter, authenticateToken, statusRoutes);
app.use('/api/polls', apiLimiter, authenticateToken, pollRoutes);
app.use('/api/linkpreview', apiLimiter, authenticateToken, linkPreviewRoutes);

// Синхронизация настроек из admin routes в auth routes при старте
const adminSettings = loadSettings();
updateAppSettings(adminSettings);
console.log('⚙️  Настройки загружены из файла');

// Проверка здоровья
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'SAVA Server' });
});

// ICE серверы для WebRTC звонков
app.get('/api/ice-servers', authenticateToken, (_req: AuthRequest, res) => {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];

  // STUN серверы
  if (config.stunUrls.length > 0) {
    iceServers.push({ urls: config.stunUrls });
  }

  // TURN сервер с временными credentials (coturn --use-auth-secret)
  if (config.turnUrl && config.turnSecret) {
    const ttl = 24 * 3600; // 24 часа
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:sava`;
    const credential = crypto
      .createHmac('sha1', config.turnSecret)
      .update(username)
      .digest('base64');

    iceServers.push({
      urls: config.turnUrl,
      username,
      credential,
    });
  }

  res.json({ iceServers });
});

// Socket.io
setupSocket(io);

// При старте сервера сбросить всех в offline
prisma.user.updateMany({ data: { isOnline: false, lastSeen: new Date() } })
  .then(() => console.log('  ✔ Все пользователи сброшены в offline'))
  .catch((e: unknown) => console.error('Ошибка сброса онлайн-статусов:', e));

// Cleanup expired stories (every 10 minutes)
import { deleteUploadedFile } from './shared';

async function cleanupExpiredStories() {
  try {
    const expired = await prisma.story.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, mediaUrl: true },
    });

    if (expired.length === 0) return;

    for (const story of expired) {
      if (story.mediaUrl) deleteUploadedFile(story.mediaUrl);
    }

    const ids = expired.map(s => s.id);
    // Cascade handles StoryView deletion via schema onDelete: Cascade
    await prisma.story.deleteMany({ where: { id: { in: ids } } });

    console.log(`  🗑 Удалено ${expired.length} истёкших историй`);
  } catch (e) {
    console.error('Story cleanup error:', e);
  }
}

cleanupExpiredStories();
setInterval(cleanupExpiredStories, 10 * 60 * 1000);

// ─── Auto-delete messages by chat retention policy ────────────────────
async function cleanupAutoDeleteMessages() {
  try {
    const chats = await prisma.chat.findMany({
      where: { autoDeleteDays: { gt: 0 } },
      select: { id: true, autoDeleteDays: true },
    });
    for (const chat of chats) {
      const cutoff = new Date(Date.now() - chat.autoDeleteDays * 24 * 60 * 60 * 1000);
      await prisma.message.updateMany({
        where: { chatId: chat.id, createdAt: { lt: cutoff }, isDeleted: false },
        data: { isDeleted: true, content: null },
      });
    }
  } catch (e) {
    console.error('Auto-delete cleanup error:', e);
  }
}
setInterval(cleanupAutoDeleteMessages, 60 * 60 * 1000); // every hour

// ─── Cleanup orphaned upload files (every 6 hours) ───────────────────
async function cleanupOrphanedFiles() {
  try {
    // Get all file URLs referenced in the database
    const [mediaUrls, avatarUrls, storyUrls, chatAvatarUrls] = await Promise.all([
      prisma.media.findMany({ select: { url: true } }),
      prisma.user.findMany({ where: { avatar: { not: null } }, select: { avatar: true } }),
      prisma.story.findMany({ where: { mediaUrl: { not: null } }, select: { mediaUrl: true } }),
      prisma.chat.findMany({ where: { avatar: { not: null } }, select: { avatar: true } }),
    ]);

    const referencedFiles = new Set<string>();
    for (const m of mediaUrls) referencedFiles.add(path.basename(m.url));
    for (const u of avatarUrls) if (u.avatar) referencedFiles.add(path.basename(u.avatar));
    for (const s of storyUrls) if (s.mediaUrl) referencedFiles.add(path.basename(s.mediaUrl));
    for (const c of chatAvatarUrls) if (c.avatar) referencedFiles.add(path.basename(c.avatar));

    // Scan uploads directory recursively
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else {
          const age = Date.now() - fs.statSync(fullPath).mtimeMs;
          // Only delete files older than 1 hour that are not referenced
          if (age > 60 * 60 * 1000 && !referencedFiles.has(entry.name)) {
            try {
              fs.unlinkSync(fullPath);
              console.log(`  🗑 Orphaned file removed: ${entry.name}`);
            } catch { /* ignore */ }
          }
        }
      }
    };

    scanDir(UPLOADS_ROOT);
  } catch (e) {
    console.error('Orphaned file cleanup error:', e);
  }
}

// Run after 5 min delay on startup, then every 6 hours
setTimeout(() => {
  cleanupOrphanedFiles();
  setInterval(cleanupOrphanedFiles, 6 * 60 * 60 * 1000);
}, 5 * 60 * 1000);

server.listen(config.port, () => {
  console.log(`\n  ⚡ SAVA Server запущен на порту ${config.port}\n`);
  logToServer('info', `SAVA Server started on port ${config.port}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n  Завершение работы...');
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
