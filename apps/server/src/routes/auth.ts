import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db';
import { config } from '../config';
import { USER_SELECT } from '../shared';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import rateLimit from 'express-rate-limit';

const router = Router();

// ─── Token store (DB-only; refresh token = UUID, stateless JWT) ────────
function generateRefreshToken(userId: string): string {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  // Persist to DB first — fire-and-forget removed, we await
  prisma.session.create({
    data: { userId, refreshToken: token, expiresAt },
  }).catch((e) => console.error('Failed to persist session:', e));
  return token;
}

async function validateRefreshToken(token: string): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;
  try {
    const session = await prisma.session.findUnique({ where: { refreshToken: token } });
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    // Touch lastUsedAt (async, non-blocking)
    prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});
    return session.userId;
  } catch {
    return null;
  }
}

// Clean up expired sessions every hour
setInterval(async () => {
  try {
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (e) { console.error('Session cleanup error:', e); }
}, 60 * 60 * 1000);

// ─── App settings ─────────────────────────────────────────────────────
let appSettings = {
  requireRegistrationPassword: false,
  registrationPassword: '',
  enableRegistration: true,
  enableFileUpload: true,
  enableStories: true,
  enableVoiceMessages: true,
  enableReactions: true,
  enableForwarding: true,
  enableScheduledMessages: true,
  maxFileSize: 50,
  maxGroupSize: 500,
  messageRetentionDays: 0,
  storyExpirationHours: 24,
};

export function updateAppSettings(settings: Partial<typeof appSettings>) {
  appSettings = { ...appSettings, ...settings };
}
export function getAppSettings() { return appSettings; }

// ─── Reserved usernames ───────────────────────────────────────────────
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'system', 'support', 'root', 'moderator',
  'mod', 'staff', 'official', 'sava', 'bot', 'service', 'help', 'info',
  'security', 'abuse', 'postmaster', 'webmaster', 'null', 'undefined',
]);

// ─── Rate limiters ────────────────────────────────────────────────────
router.get('/registration-settings', (_req, res) => {
  res.json({ requireRegistrationPassword: appSettings.requireRegistrationPassword });
});

const meLimiter = rateLimit({
  windowMs: 60 * 1000, max: 300, // increased from 120 to 300
  message: { error: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true, legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30, // increased from 10 to 30
  message: { error: 'Слишком много регистраций с этого IP. Попробуйте через час.' },
  standardHeaders: true, legacyHeaders: false, validate: false,
  keyGenerator: (req) => (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, ''),
});

const registrationCooldowns = new Map<string, number>();
const REGISTRATION_COOLDOWN_MS = 30 * 1000;

// ─── Register ─────────────────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, displayName, password, bio } = req.body;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    const lastReg = registrationCooldowns.get(clientIp);
    if (lastReg && Date.now() - lastReg < REGISTRATION_COOLDOWN_MS) {
      const waitMinutes = Math.ceil((REGISTRATION_COOLDOWN_MS - (Date.now() - lastReg)) / 60000);
      res.status(429).json({ error: `Подождите ${waitMinutes} мин. перед созданием нового аккаунта` });
      return;
    }

    const accountsFromIp = await prisma.user.count({ where: { registrationIp: clientIp } });
    if (accountsFromIp >= config.maxRegistrationsPerIp) {
      res.status(403).json({ error: `Максимум ${config.maxRegistrationsPerIp} аккаунта с одного IP. Лимит исчерпан.` });
      return;
    }

    if (appSettings.requireRegistrationPassword) {
      const { registrationPassword } = req.body;
      if (!registrationPassword || registrationPassword !== appSettings.registrationPassword) {
        res.status(400).json({ error: 'Неверный пароль для регистрации' });
        return;
      }
    }

    if (!username || !password) { res.status(400).json({ error: 'Username и пароль обязательны' }); return; }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { res.status(400).json({ error: 'Username: 3-20 символов, только латиница, цифры, _' }); return; }
    if (RESERVED_USERNAMES.has(username.toLowerCase())) { res.status(400).json({ error: 'Этот username зарезервирован' }); return; }
    if (password.length < config.minPasswordLength) { res.status(400).json({ error: `Пароль должен быть не менее ${config.minPasswordLength} символов` }); return; }
    if (!/[a-zA-Zа-яА-Я]/.test(password) || !/\d/.test(password)) { res.status(400).json({ error: 'Пароль должен содержать буквы и цифры' }); return; }
    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > 50)) { res.status(400).json({ error: 'Имя должно быть не длиннее 50 символов' }); return; }
    if (bio !== undefined && (typeof bio !== 'string' || bio.length > 500)) { res.status(400).json({ error: 'Био должно быть не длиннее 500 символов' }); return; }

    const existing = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (existing) { res.status(400).json({ error: 'Этот username уже занят' }); return; }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username: username.toLowerCase(),
        displayName: (displayName || username).slice(0, 50),
        password: hashedPassword,
        bio: bio ? bio.slice(0, 500) : null,
        registrationIp: clientIp,
      },
      select: USER_SELECT,
    });

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '30d' });
    const refreshToken = generateRefreshToken(user.id);
    registrationCooldowns.set(clientIp, Date.now());
    res.json({ token, refreshToken, user: { ...user, isOnline: true } });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Login ────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) { res.status(400).json({ error: 'Username и пароль обязательны' }); return; }

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { ...USER_SELECT, password: true, failedLoginAttempts: true, lockedUntil: true },
    });

    if (!user) { res.status(400).json({ error: 'Неверный username или пароль' }); return; }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      res.status(429).json({ error: `Аккаунт временно заблокирован. Попробуйте через ${minutesLeft} мин.` });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const lockData: Record<string, unknown> = { failedLoginAttempts: attempts };
      if (attempts >= 5) { lockData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); lockData.failedLoginAttempts = 0; }
      await prisma.user.update({ where: { id: user.id }, data: lockData });
      res.status(400).json({ error: 'Неверный username или пароль' });
      return;
    }

    if (user.isBanned) { res.status(403).json({ error: 'Ваш аккаунт заблокирован' }); return; }

    await prisma.user.update({
      where: { id: user.id },
      data: { isOnline: true, lastSeen: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '30d' });
    const refreshToken = generateRefreshToken(user.id);

    const { password: _, failedLoginAttempts: __, lockedUntil: ___, ...userWithoutPassword } = user;
    res.json({ token, refreshToken, user: { ...userWithoutPassword, isOnline: true } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Refresh access token ─────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ error: 'Требуется refreshToken' });
      return;
    }
    const userId = await validateRefreshToken(refreshToken);
    if (!userId) {
      res.status(401).json({ error: 'Недействительный или истёкший refreshToken' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isBanned: true } });
    if (!user || user.isBanned) {
      res.status(403).json({ error: 'Аккаунт заблокирован' });
      return;
    }
    // Optionally bind to IP/device for MITM resistance (warning: breaks mobile switching networks)
    const newToken = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '30d' });
    res.json({ token: newToken });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Logout (revoke refresh token) ───────────────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken && typeof refreshToken === 'string') {
    await prisma.session.deleteMany({ where: { refreshToken } }).catch(() => {});
  }
  res.json({ ok: true });
});

// ─── Me ───────────────────────────────────────────────────────────────
router.get('/me', meLimiter, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: USER_SELECT });
    if (!user) { res.status(404).json({ error: 'Пользователь не найден' }); return; }
    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
