import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';

export interface AuthRequest extends Request {
  userId?: string;
}

const SAFE_ORIGINS = new Set([
  'http://localhost:5173', 'https://localhost:5173',
  'http://localhost:3000', 'https://localhost:3000',
  'http://localhost:3001', 'https://localhost:3001',
  'http://localhost:3002', 'https://localhost:3002',
  'http://198.18.0.1:5173', 'https://198.18.0.1:5173',
  'http://198.18.0.1:3001', 'https://198.18.0.1:3001',
]);
const SAFE_HOSTS = new Set(['localhost', '127.0.0.1']);

function isSafeOrigin(req: Request): boolean {
  const origin = req.headers['origin'];
  if (!origin) return true; // No origin header (curl/internal) — pass through
  try {
    const url = new URL(origin);
    if (SAFE_ORIGINS.has(origin)) return true;
    if (SAFE_HOSTS.has(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const origin = req.headers['origin'];
  if (origin && !isSafeOrigin(req)) {
    res.status(403).json({ error: 'Недопустимый origin' });
    return;
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
    req.userId = decoded.userId;

    // Check if user is banned
    try {
      const user = await prisma.user.findUnique({ 
        where: { id: decoded.userId }, 
        select: { isBanned: true } 
      });
      
      if (user?.isBanned) {
        res.status(403).json({ error: 'Аккаунт заблокирован' });
        return;
      }
      
      next();
    } catch (dbError) {
      console.error('[Auth] Database error checking ban status:', dbError);
      next();
    }
  } catch {
    res.status(403).json({ error: 'Недействительный токен' });
    return;
  }
}
