import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import { encryptFileInPlace, isEncryptionEnabled } from './encrypt';
import sharp from 'sharp';

// ─── Magic bytes validation ───────────────────────────────────────────

/** Known safe magic byte signatures mapped to allowed MIME types */
const MAGIC_SIGNATURES: Array<{ bytes: number[]; mime: string }> = [
  // Images
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png' },
  { bytes: [0x47, 0x49, 0x46], mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF....WEBP
  // Video
  { bytes: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], mime: 'video/mp4' }, // ftyp
  { bytes: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], mime: 'video/mp4' },
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm' }, // WebM container (can be audio or video)
  // Audio
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' }, // MP3 ID3
  { bytes: [0xFF, 0xFB], mime: 'audio/mpeg' },        // MP3
  { bytes: [0xFF, 0xF3], mime: 'audio/mpeg' },
  { bytes: [0x4F, 0x67, 0x67, 0x53], mime: 'audio/ogg' }, // OggS
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'audio/wav' }, // RIFF....WAVE
  // Note: audio/webm uses same signature as video/webm (0x1A 0x45 0xDF 0xA3)
  { bytes: [0x66, 0x4C, 0x61, 0x43], mime: 'audio/flac' },
  // Documents
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' }, // %PDF
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip' }, // ZIP (docx, xlsx, etc.)
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], mime: 'application/msword' }, // DOC
];

/**
 * Read the first 16 bytes of a file and check against known magic signatures.
 * Returns true if the file matches any known safe type, false otherwise.
 */
function validateMagicBytes(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    
    if (bytesRead < 2) return false;

    // Check each signature independently
    let matchCount = 0;
    const matchedTypes: string[] = [];
    for (const sig of MAGIC_SIGNATURES) {
      if (sig.bytes.every((b, i) => buf[i] === b)) {
        matchCount++;
        matchedTypes.push(sig.mime);
      }
    }
    
    // Allow files that match exactly one signature
    if (matchCount === 1) return true;
    
    // Special case: WebM and RIFF containers can match multiple times (audio/video variants)
    // This is safe because they share the same container format
    if (matchCount > 1) {
      const isWebM = matchedTypes.every(t => t.includes('webm'));
      const isRIFF = matchedTypes.every(t => t.includes('wav') || t.includes('webp'));
      if (isWebM || isRIFF) return true;
    }
    
    // Allow plain text files (no magic bytes needed — they start with printable ASCII)
    const isText = buf.slice(0, bytesRead).every(b => (b >= 0x09 && b <= 0x0D) || (b >= 0x20 && b <= 0x7E));
    return isText && matchCount === 0;
  } catch {
    return false;
  }
}

/**
 * Express middleware: validates magic bytes of uploaded file.
 * Deletes the file and returns 400 if validation fails.
 */
export function validateFileMagicBytes(req: Request, res: Response, next: NextFunction): void {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    const f = req.files;
    if (Array.isArray(f)) files.push(...f);
    else Object.values(f).forEach(arr => files.push(...arr));
  }

  for (const file of files) {
    if (!validateMagicBytes(file.path)) {
      // Delete the suspicious file
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      res.status(400).json({ error: 'Недопустимый тип файла' });
      return;
    }
  }
  next();
}

// ─── Prisma select objects ────────────────────────────────────────────

/** Standard user fields to include in API responses (excludes password) */
export const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  bio: true,
  birthday: true,
  e2eePublicKey: true,
  isOnline: true,
  lastSeen: true,
  createdAt: true,
  hideStoryViews: true,
  isBanned: true,
  banReason: true,
  bannedAt: true,
  statusEmoji: true,
  statusText: true,
  dndEnabled: true,
  dndFrom: true,
  dndTo: true,
  blockedUserIds: true,
} as const;

/** Compact user fields for message sender / forwarded-from */
export const SENDER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatar: true,
  e2eePublicKey: true,
} as const;

/** Full message include for API responses */
export const MESSAGE_INCLUDE = {
  sender: { select: SENDER_SELECT },
  forwardedFrom: { select: SENDER_SELECT },
  replyTo: {
    include: { sender: { select: { id: true, username: true, displayName: true } } },
  },
  media: true,
  reactions: {
    include: { user: { select: { id: true, username: true, displayName: true } } },
  },
  readBy: { select: { userId: true } },
} as const;

// ─── File system helpers ──────────────────────────────────────────────

const uploadsRoot = path.join(__dirname, '../uploads');

/** Ensure a directory exists (recursive). */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Safely delete a file from the uploads directory given its URL path (e.g. '/uploads/avatars/abc.jpg'). */
export function deleteUploadedFile(urlPath: string): void {
  if (!urlPath) return;
  try {
    const filename = urlPath.replace(/^\/uploads\//, '');
    const filePath = path.resolve(uploadsRoot, filename);

    // Path containment check — prevent directory traversal
    if (!filePath.startsWith(uploadsRoot)) {
      console.error('Path traversal attempt blocked:', urlPath);
      return;
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error('Failed to delete file:', urlPath, e);
  }
}

// ─── Multer configurations ───────────────────────────────────────────

const avatarsDir = path.join(uploadsRoot, 'avatars');
ensureDir(avatarsDir);
ensureDir(uploadsRoot);

/** Allowed image extensions for avatars. */
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

function createAvatarStorage(prefix = '') {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${prefix}${uuidv4()}${ext}`);
    },
  });
}

/** Multer middleware for user avatar uploads (max 5MB, images only). */
export const uploadUserAvatar = multer({
  storage: createAvatarStorage(''),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && ALLOWED_IMAGE_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new Error('Только изображения (jpg, png, gif, webp, avif)'));
  },
});

/** Multer middleware for group avatar uploads (max 5MB, images only). */
export const uploadGroupAvatar = multer({
  storage: createAvatarStorage('group-'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && ALLOWED_IMAGE_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new Error('Только изображения (jpg, png, gif, webp, avif)'));
  },
});

/** Blocked file extensions that could be served as executable content. */
const BLOCKED_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.xml', '.xhtml',
  '.php', '.jsp', '.asp', '.aspx', '.cgi',
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.sh', '.bash', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.dll', '.sys', '.drv',
  '.hta', '.cpl', '.inf', '.reg',
]);

/** Multer middleware for general file uploads (max 50MB). */
export const uploadFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      cb(new Error('Этот тип файла не разрешён'));
    } else {
      cb(null, true);
    }
  },
});

// ─── Avatar resize middleware ─────────────────────────────────────────

/**
 * Resize an uploaded avatar to 256×256 JPEG in-place.
 * Runs after multer, before encryption.
 */
export async function resizeAvatar(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const file = req.file;
  if (!file) return next();
  try {
    const resized = await sharp(file.path)
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
    // Overwrite original with resized version
    fs.writeFileSync(file.path, resized);
    // Update mimetype and size metadata
    file.mimetype = 'image/jpeg';
    file.size = resized.length;
  } catch (e) {
    console.error('Avatar resize error:', e);
    // Don't block — serve original if resize fails
  }
  next();
}

// ─── Post-upload file encryption middleware ───────────────────────────

/**
 * Express middleware that encrypts an uploaded file in-place after multer
 * has written it to disk. Use after any multer middleware.
 */
export function encryptUploadedFile(req: Request, _res: Response, next: NextFunction): void {
  if (!isEncryptionEnabled()) return next();

  try {
    // Single file upload (req.file)
    if (req.file) {
      encryptFileInPlace(req.file.path);
    }
    // Multiple files (req.files) — handle both array and field-keyed forms
    if (req.files) {
      const files = Array.isArray(req.files)
        ? req.files
        : Object.values(req.files).flat();
      for (const file of files) {
        encryptFileInPlace(file.path);
      }
    }
  } catch (e) {
    console.error('File encryption error:', e);
    // Don't block the request — file is already saved, just unencrypted
  }

  next();
}

/** Absolute path to the uploads root directory. */
export const UPLOADS_ROOT = uploadsRoot;
