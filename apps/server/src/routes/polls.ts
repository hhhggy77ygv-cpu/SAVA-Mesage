/**
 * Poll routes — create polls, vote, get results
 */
import { Router } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Get poll with results for a message
router.get('/:messageId', async (req: AuthRequest, res) => {
  try {
    const messageId = String(req.params.messageId);

    // Verify user is member of the chat
    const message = await prisma.message.findUnique({ where: { id: messageId }, select: { chatId: true } });
    if (!message) { res.status(404).json({ error: 'Сообщение не найдено' }); return; }

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: message.chatId, userId: req.userId! } },
    });
    if (!member) { res.status(403).json({ error: 'Нет доступа' }); return; }

    const poll = await prisma.poll.findUnique({
      where: { messageId },
      include: { votes: { select: { userId: true, optionId: true } } },
    });
    if (!poll) { res.status(404).json({ error: 'Опрос не найден' }); return; }

    const options: { id: string; text: string }[] = JSON.parse(poll.options);
    const myVotes = poll.votes.filter(v => v.userId === req.userId).map(v => v.optionId);

    // Count votes per option using BigInt to prevent overflow
    const voteCounts: Record<string, number> = {};
    for (const opt of options) voteCounts[opt.id] = 0;
    for (const vote of poll.votes) {
      if (voteCounts[vote.optionId] !== undefined) {
        voteCounts[vote.optionId] = Math.min(voteCounts[vote.optionId] + 1, Number.MAX_SAFE_INTEGER);
      }
    }

    res.json({
      id: poll.id,
      question: poll.question,
      multipleChoice: poll.multipleChoice,
      options: options.map(o => ({ ...o, votes: voteCounts[o.id] || 0 })),
      totalVotes: poll.votes.length,
      myVotes,
    });
  } catch (e) {
    console.error('Get poll error:', e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Vote on a poll
router.post('/:messageId/vote', async (req: AuthRequest, res) => {
  try {
    const messageId = String(req.params.messageId);
    const { optionIds } = req.body; // array of option IDs

    if (!Array.isArray(optionIds) || optionIds.length === 0) {
      res.status(400).json({ error: 'Укажите варианты ответа' });
      return;
    }

    const message = await prisma.message.findUnique({ where: { id: messageId }, select: { chatId: true } });
    if (!message) { res.status(404).json({ error: 'Сообщение не найдено' }); return; }

    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: message.chatId, userId: req.userId! } },
    });
    if (!member) { res.status(403).json({ error: 'Нет доступа' }); return; }

    const poll = await prisma.poll.findUnique({ where: { messageId } });
    if (!poll) { res.status(404).json({ error: 'Опрос не найден' }); return; }

    const options: { id: string }[] = JSON.parse(poll.options);
    const validIds = new Set(options.map(o => o.id));
    const toVote = optionIds.filter((id: string) => validIds.has(id));

    if (!poll.multipleChoice && toVote.length > 1) {
      res.status(400).json({ error: 'Этот опрос допускает только один вариант' });
      return;
    }

    // Remove existing votes from this user, then add new ones
    await prisma.pollVote.deleteMany({ where: { pollId: poll.id, userId: req.userId! } });
    await prisma.pollVote.createMany({
      data: toVote.map((optionId: string) => ({ pollId: poll.id, userId: req.userId!, optionId })),
    });

    // Return updated results
    const allVotes = await prisma.pollVote.findMany({ where: { pollId: poll.id }, select: { userId: true, optionId: true } });
    const voteCounts: Record<string, number> = {};
    for (const opt of options) voteCounts[opt.id] = 0;
    for (const vote of allVotes) { if (voteCounts[vote.optionId] !== undefined) voteCounts[vote.optionId]++; }

    res.json({
      options: options.map(o => ({ id: o.id, votes: voteCounts[o.id] || 0 })),
      totalVotes: allVotes.length,
      myVotes: toVote,
    });
  } catch (e) {
    console.error('Vote error:', e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
