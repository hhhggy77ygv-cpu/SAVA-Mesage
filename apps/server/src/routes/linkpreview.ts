/**
 * Link preview endpoint — fetches Open Graph / meta tags from a URL
 * and returns title, description, image, favicon.
 */
import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const router = Router();

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024; // 256 KB — enough for <head>
const MAX_META_TAGS = 100;   // Hard cap to prevent ReDoS

function fetchHtml(rawUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { reject(new Error('Invalid URL')); return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      reject(new Error('Only http/https allowed')); return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(rawUrl, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SAVABot/1.0)',
        'Accept': 'text/html',
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        fetchHtml(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const ct = res.headers['content-type'] || '';
      if (!ct.includes('text/html')) { reject(new Error('Not HTML')); return; }

      let data = '';
      let bytes = 0;
      let tagCount = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        data += chunk.toString('utf8');
        tagCount += (chunk.toString('utf8').match(/<meta/g) || []).length;
        // Stop reading once we have the <head> section or hit limits
        if (bytes > MAX_BYTES || tagCount > MAX_META_TAGS || data.includes('</head>')) {
          res.destroy();
          resolve(data);
        }
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractMeta(html: string, url: string): {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
} {
  // Safe regex — fixed patterns, no dynamic interpolation (prevents ReDoS)
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  const title = ogTitle?.[1] || metaDesc?.[1] || titleMatch?.[1]?.trim() || null;
  const description = ogDesc?.[1] || metaDesc?.[1] || null;
  let image = ogImage?.[1] || null;
  const siteName = ogSite?.[1] || null;

  // Resolve relative image URL
  if (image && !image.startsWith('http')) {
    try {
      const base = new URL(url);
      image = new URL(image, base).toString();
    } catch { image = null; }
  }

  // Favicon
  let favicon: string | null = null;
  try {
    const base = new URL(url);
    favicon = `${base.protocol}//${base.host}/favicon.ico`;
  } catch { /* ignore */ }

  return { title, description, image, favicon, siteName };
}

// GET /api/linkpreview?url=https://...
router.get('/', async (req: AuthRequest, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url обязателен' });
    return;
  }

  // Basic URL validation
  try { new URL(url); } catch {
    res.status(400).json({ error: 'Некорректный URL' });
    return;
  }

  // Block private/local IPs
  const hostname = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    res.status(403).json({ error: 'Недопустимый адрес' });
    return;
  }

  try {
    const html = await fetchHtml(url);
    const meta = extractMeta(html, url);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ url, ...meta });
  } catch (e) {
    res.status(422).json({ error: 'Не удалось получить превью' });
  }
});

export default router;
