import { Router } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { USER_SELECT, SENDER_SELECT, uploadUserAvatar, deleteUploadedFile, encryptUploadedFile, validateFileMagicBytes, resizeAvatar } from '../shared';
import { registerKey } from '../e2ee';
import rateLimit from 'express-rate-limit';

const router = Router();

// Регистрация E2EE публичного ключа
router.post('/e2ee-key', async (req: AuthRequest, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ error: 'Требуется publicKey' });
      return;
    }
    const success = await registerKey(req.userId!, publicKey);
    if (!success) {
      res.status(400).json({ error: 'Некорректный публичный ключ' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('E2EE key registration error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение E2EE публичных ключей пользователей
router.post('/e2ee-keys', async (req: AuthRequest, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 100) {
      res.status(400).json({ error: 'Требуется массив userIds (1-100)' });
      return;
    }
    const keys = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, e2eePublicKey: true },
    });
    const result: Record<string, string | null> = {};
    for (const u of keys) {
      result[u.id] = u.e2eePublicKey || null;
    }
    res.json(result);
  } catch (error) {
    console.error('E2EE keys fetch error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Поиск пользователей
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // increased from 20 to 60
  message: { error: 'Слишком много запросов поиска' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Зарезервированные username
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'system', 'support', 'root', 'moderator',
  'mod', 'staff', 'official', 'sava', 'bot', 'service', 'help', 'info',
  'security', 'abuse', 'postmaster', 'webmaster', 'null', 'undefined',
]);

router.get('/search', searchLimiter, async (req: AuthRequest, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 3) {
      res.json([]);
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q } },
          { displayName: { contains: q } },
        ],
        NOT: { id: req.userId },
      },
      select: USER_SELECT,
      take: 20,
    });

    res.json(users);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Профиль пользователя
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: String(req.params.id) },
      select: USER_SELECT,
    });

    if (!user) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузить аватар
router.post('/avatar', uploadUserAvatar.single('avatar'), validateFileMagicBytes, resizeAvatar, encryptUploadedFile, async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Файл не загружен' });
      return;
    }

    // Capture old avatar BEFORE updating DB
    const oldAvatar = await prisma.user.findUnique({ where: { id: req.userId }, select: { avatar: true } });

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatar: avatarUrl },
      select: USER_SELECT,
    });

    // Delete old avatar only after DB update succeeds
    if (oldAvatar?.avatar) deleteUploadedFile(oldAvatar.avatar);

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка загрузки аватара' });
  }
});

// Удалить аватар
router.delete('/avatar', async (req: AuthRequest, res) => {
  try {
    // Delete file from disk
    const currentUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { avatar: true } });
    if (currentUser?.avatar) deleteUploadedFile(currentUser.avatar);

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatar: null },
      select: USER_SELECT,
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления аватара' });
  }
});

// Обновить профиль (username НЕ меняется!)
router.put('/profile', async (req: AuthRequest, res) => {
  try {
    const { displayName, bio, birthday } = req.body;

    // Validate field lengths
    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.trim().length > 50)) {
      res.status(400).json({ error: 'Имя должно быть от 1 до 50 символов' });
      return;
    }
    if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 500)) {
      res.status(400).json({ error: 'Био должно быть не длиннее 500 символов' });
      return;
    }
    if (birthday !== undefined && birthday !== null) {
      if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday) || isNaN(Date.parse(birthday))) {
        res.status(400).json({ error: 'Некорректный формат даты рождения (YYYY-MM-DD)' });
        return;
      }
    }

    const updateData: Record<string, string | null> = {};
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (bio !== undefined) updateData.bio = bio ? bio.trim() : bio;
    if (birthday !== undefined) updateData.birthday = birthday;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: updateData,
      select: USER_SELECT,
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Поиск сообщений
router.get('/messages/search', async (req: AuthRequest, res) => {
  try {
    const { q, chatId } = req.query;
    if (!q || typeof q !== 'string') {
      res.json([]);
      return;
    }

    const where: Record<string, unknown> = {
      content: { contains: q },
      isDeleted: false,
    };

    if (chatId) {
      where.chatId = chatId;
      const member = await prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId: chatId as string, userId: req.userId! } },
      });
      if (member?.clearedAt) {
        where.createdAt = { gt: member.clearedAt };
      }
    } else {
      where.chat = {
        members: { some: { userId: req.userId } },
      };
    }

    const messages = await prisma.message.findMany({
      where,
      include: {
        sender: { select: SENDER_SELECT },
        chat: {
          select: {
            id: true,
            name: true,
            type: true,
            members: {
              include: {
                user: { select: { id: true, username: true, displayName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // For global search (no chatId filter), filter out messages before clearedAt per chat
    let filtered = messages;
    if (!chatId) {
      const memberships = await prisma.chatMember.findMany({
        where: { userId: req.userId! },
        select: { chatId: true, clearedAt: true },
      });
      const clearedMap = new Map<string, Date>();
      for (const m of memberships) {
        if (m.clearedAt) clearedMap.set(m.chatId, m.clearedAt);
      }
      if (clearedMap.size > 0) {
        filtered = messages.filter((msg) => {
          const cleared = clearedMap.get(msg.chatId);
          if (!cleared) return true;
          return new Date(msg.createdAt) > new Date(cleared);
        });
      }
    }

    res.json(filtered);
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить настройки приватности
router.put('/settings', async (req: AuthRequest, res) => {
  try {
    const { hideStoryViews } = req.body;

    const updateData: Record<string, boolean> = {};
    if (typeof hideStoryViews === 'boolean') updateData.hideStoryViews = hideStoryViews;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: updateData,
      select: USER_SELECT,
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

export default router;
