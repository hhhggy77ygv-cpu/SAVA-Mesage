/**
 * User status, block list, DND, sessions routes
 */
import { Router } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { USER_SELECT } from '../shared';

const router = Router();

// ─── Custom status ────────────────────────────────────────────────────

router.put('/status', async (req: AuthRequest, res) => {
  try {
    const { emoji, text } = req.body;
    if (emoji !== undefined && typeof emoji !== 'string') { res.status(400).json({ error: 'Некорректный emoji' }); return; }
    if (text !== undefined && typeof text !== 'string') { res.status(400).json({ error: 'Некорректный текст' }); return; }
    if (text && text.length > 80) { res.status(400).json({ error: 'Статус не более 80 символов' }); return; }

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        statusEmoji: emoji ?? null,
        statusText: text ? text.trim() : null,
      },
      select: USER_SELECT,
    });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Block / Unblock ──────────────────────────────────────────────────

router.post('/block/:targetId', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const targetId = String(req.params.targetId);
    if (userId === targetId) { res.status(400).json({ error: 'Нельзя заблокировать себя' }); return; }

    const me = await prisma.user.findUnique({ where: { id: userId }, select: { blockedUserIds: true } });
    const blocked: string[] = JSON.parse(me?.blockedUserIds || '[]');
    if (!blocked.includes(targetId)) blocked.push(targetId);

    await prisma.user.update({ where: { id: userId }, data: { blockedUserIds: JSON.stringify(blocked) } });
    res.json({ ok: true, blockedUserIds: blocked });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/block/:targetId', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const targetId = String(req.params.targetId);

    const me = await prisma.user.findUnique({ where: { id: userId }, select: { blockedUserIds: true } });
    const blocked: string[] = JSON.parse(me?.blockedUserIds || '[]');
    const updated = blocked.filter(id => id !== targetId);

    await prisma.user.update({ where: { id: userId }, data: { blockedUserIds: JSON.stringify(updated) } });
    res.json({ ok: true, blockedUserIds: updated });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/blocked', async (req: AuthRequest, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.userId! }, select: { blockedUserIds: true } });
    const ids: string[] = JSON.parse(me?.blockedUserIds || '[]');
    if (ids.length === 0) { res.json([]); return; }
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, displayName: true, avatar: true } });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Do Not Disturb ───────────────────────────────────────────────────

router.put('/dnd', async (req: AuthRequest, res) => {
  try {
    const { enabled, from, to } = req.body;
    if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled обязателен' }); return; }
    // Validate HH:MM format with bounds checking (00:00-23:59)
    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (from && !timeRe.test(from)) { res.status(400).json({ error: 'Некорректный формат from (HH:MM)' }); return; }
    if (to && !timeRe.test(to)) { res.status(400).json({ error: 'Некорректный формат to (HH:MM)' }); return; }
    // Warn if from >= to (DND period would be zero or negative)
    if (from && to && from >= to) {
      res.status(400).json({ error: 'Время начала DND должно быть раньше времени окончания' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { dndEnabled: enabled, dndFrom: from ?? null, dndTo: to ?? null },
      select: USER_SELECT,
    });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Sessions ─────────────────────────────────────────────────────────

router.get('/sessions', async (req: AuthRequest, res) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, expiresAt: { gt: new Date() } },
      select: { id: true, deviceInfo: true, ipAddress: true, createdAt: true, lastUsedAt: true },
      orderBy: { lastUsedAt: 'desc' },
    });
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/sessions/:sessionId', async (req: AuthRequest, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== req.userId) { res.status(404).json({ error: 'Сессия не найдена' }); return; }
    await prisma.session.delete({ where: { id: sessionId } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/sessions', async (req: AuthRequest, res) => {
  try {
    const { currentToken } = req.body;
    await prisma.session.deleteMany({
      where: { userId: req.userId!, NOT: currentToken ? { refreshToken: currentToken } : undefined },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
