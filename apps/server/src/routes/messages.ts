import { Router } from 'express';
import { prisma } from '../db';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { SENDER_SELECT, MESSAGE_INCLUDE, uploadFile, deleteUploadedFile, encryptUploadedFile, validateFileMagicBytes } from '../shared';
import { getAppSettings } from './auth';

const router = Router();

// Получить сообщения чата
router.get('/chat/:chatId', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.chatId);
    const { cursor, limit = '50' } = req.query;
    const take = Math.min(Math.max(1, parseInt(limit as string) || 50), 200);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });

    if (!member) {
      res.status(403).json({ error: 'Нет доступа к этому чату' });
      return;
    }

    const createdAtFilter: Record<string, Date> = {};
    if (cursor) createdAtFilter.lt = new Date(cursor as string);
    if (member.clearedAt) createdAtFilter.gt = member.clearedAt;

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        isDeleted: false,
        hiddenBy: { none: { userId: req.userId! } },
        // Scheduled messages: only visible to the sender until delivered
        OR: [
          { scheduledAt: null },
          { senderId: req.userId! },
        ],
        ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.json(messages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Загрузка файла
router.post('/upload', uploadFile.single('file'), validateFileMagicBytes, encryptUploadedFile, async (req: AuthRequest, res) => {
  try {
    const settings = getAppSettings();
    if (!settings.enableFileUpload) {
      res.status(403).json({ error: 'Загрузка файлов отключена администратором' });
      return;
    }
    
    if (!req.file) {
      res.status(400).json({ error: 'Файл не загружен' });
      return;
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    // multer decodes multipart filenames as latin1 — re-decode as UTF-8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    res.json({
      url: fileUrl,
      filename: originalName,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// Редактировать сообщение
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    const id = String(req.params.id);

    if (!content || typeof content !== 'string' || content.length > 10000) {
      res.status(400).json({ error: 'Содержимое обязательно и не должно превышать 10000 символов' });
      return;
    }

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message || message.senderId !== req.userId) {
      res.status(403).json({ error: 'Нет прав для редактирования' });
      return;
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { content, isEdited: true },
      include: MESSAGE_INCLUDE,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить сообщение
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);

    const message = await prisma.message.findUnique({
      where: { id },
      include: { media: true },
    });
    if (!message || message.senderId !== req.userId) {
      res.status(403).json({ error: 'Нет прав для удаления' });
      return;
    }

    // Delete media files from disk
    if (message.media && message.media.length > 0) {
      for (const m of message.media) {
        if (m.url) deleteUploadedFile(m.url);
      }
      await prisma.media.deleteMany({ where: { messageId: id } });
    }

    await prisma.message.update({
      where: { id },
      data: { isDeleted: true, content: null },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить общие медиа/файлы/ссылки чата
router.get('/chat/:chatId/shared', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.chatId);
    const { type } = req.query; // 'media' | 'files' | 'links'

    // Check membership
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });
    if (!member) {
      res.status(403).json({ error: 'Нет доступа' });
      return;
    }

    const baseWhere: Prisma.MessageWhereInput = {
      chatId,
      isDeleted: false,
      hiddenBy: { none: { userId: req.userId! } },
      ...(member.clearedAt ? { createdAt: { gt: member.clearedAt } } : {}),
    };

    if (type === 'media') {
      // Images and videos
      const messages = await prisma.message.findMany({
        where: {
          ...baseWhere,
          media: { some: { type: { in: ['image', 'video'] } } },
        },
        include: {
          media: { where: { type: { in: ['image', 'video'] } } },
          sender: { select: SENDER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(messages);
    } else if (type === 'files') {
      // Files (documents, archives, audio, etc.)
      const messages = await prisma.message.findMany({
        where: {
          ...baseWhere,
          media: { some: { type: { notIn: ['image', 'video'] } } },
        },
        include: {
          media: { where: { type: { notIn: ['image', 'video'] } } },
          sender: { select: SENDER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(messages);
    } else if (type === 'links') {
      // Messages containing URLs
      const messages = await prisma.message.findMany({
        where: {
          ...baseWhere,
          content: { contains: 'http' },
        },
        include: {
          sender: { select: SENDER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      // Filter to only messages with actual URLs
      const withLinks = messages
        .filter((m) => m.content && /https?:\/\/[^\s]+/i.test(m.content))
        .map((m) => {
          const links = m.content!.match(/https?:\/\/[^\s]+/gi) || [];
          return { ...m, links };
        });
      res.json(withLinks);
    } else {
      res.status(400).json({ error: 'Invalid type. Use: media, files, or links' });
    }
  } catch (error) {
    console.error('Shared media error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Экспорт истории чата в JSON
router.get('/chat/:chatId/export', async (req: AuthRequest, res) => {
  try {
    const chatId = String(req.params.chatId);

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: req.userId! } },
    });
    if (!member) {
      res.status(403).json({ error: 'Нет доступа к этому чату' });
      return;
    }

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        isDeleted: false,
        hiddenBy: { none: { userId: req.userId! } },
        ...(member.clearedAt ? { createdAt: { gt: member.clearedAt } } : {}),
      },
      include: {
        sender: { select: { id: true, username: true, displayName: true } },
        media: { select: { type: true, url: true, filename: true, size: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 10000,
    });

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { name: true, type: true },
    });

    const exportData = {
      chatId,
      chatName: chat?.name || chatId,
      chatType: chat?.type,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        sender: m.sender.displayName || m.sender.username,
        content: m.content,
        type: m.type,
        media: m.media,
        createdAt: m.createdAt,
        isEdited: m.isEdited,
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${chatId}-export.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('Export chat error:', error);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

export default router;
