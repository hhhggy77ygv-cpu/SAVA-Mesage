import fs from 'fs';
import path from 'path';

const LOG_PATH = path.join(__dirname, '../server.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '');

/** Rotate log file if it exceeds MAX_LOG_SIZE — keeps last half */
function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size < MAX_LOG_SIZE) return;
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const keep = lines.slice(Math.floor(lines.length / 2));
    fs.writeFileSync(LOG_PATH, keep.join('\n') + '\n');
  } catch { /* ignore */ }
}

/** Mask sensitive fields from log messages */
function maskSensitive(message: string): string {
  return message
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/("token"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/("refreshToken"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]');
}

export function logToServer(level: string, message: string) {
  const timestamp = new Date().toISOString();
  const masked = maskSensitive(message);
  const line = `[${timestamp}] [${level.toUpperCase()}] ${masked}\n`;
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_PATH, line);
  } catch { /* ignore */ }
}

export function readServerLogs(lines = 100) {
  try {
    if (!fs.existsSync(LOG_PATH)) return [];
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    return content.split('\n').filter(l => l.trim()).slice(-lines);
  } catch { return []; }
}

export function clearServerLogs() {
  try { fs.writeFileSync(LOG_PATH, ''); } catch { /* ignore */ }
}
