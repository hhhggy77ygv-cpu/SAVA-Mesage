import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
}

interface LinkPreviewProps {
  url: string;
  isMine: boolean;
}

// Module-level cache so the same URL isn't fetched twice across renders
const previewCache = new Map<string, LinkPreviewData | null>();

export default function LinkPreview({ url, isMine }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewData | null | undefined>(
    previewCache.has(url) ? previewCache.get(url) : undefined
  );

  useEffect(() => {
    if (previewCache.has(url)) {
      setData(previewCache.get(url));
      return;
    }
    let cancelled = false;
    api.getLinkPreview(url)
      .then(result => {
        if (cancelled) return;
        // Only show if we got at least a title
        const value = result.title ? result : null;
        previewCache.set(url, value);
        setData(value);
      })
      .catch(() => {
        previewCache.set(url, null);
        setData(null);
      });
    return () => { cancelled = true; };
  }, [url]);

  // Not loaded yet or no useful data
  if (data === undefined) return (
    <div className={`mt-2 h-14 rounded-xl animate-pulse ${isMine ? 'bg-white/10' : 'bg-white/5'}`} />
  );
  if (!data) return null;

  const domain = (() => {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
  })();

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={`mt-2 flex gap-3 rounded-xl overflow-hidden border transition-all hover:brightness-110 ${
        isMine
          ? 'bg-white/10 border-white/10 hover:bg-white/15'
          : 'bg-black/20 border-white/8 hover:bg-black/30'
      }`}
    >
      {/* Image */}
      {data.image && (
        <img
          src={data.image}
          alt=""
          loading="lazy"
          className="w-20 h-20 object-cover flex-shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Text */}
      <div className="flex-1 min-w-0 py-2 pr-3 flex flex-col justify-center gap-0.5">
        {/* Site name / domain */}
        <div className="flex items-center gap-1.5">
          {data.favicon && (
            <img src={data.favicon} alt="" className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
          <span className={`text-[10px] font-medium truncate ${isMine ? 'text-white/50' : 'text-zinc-500'}`}>
            {data.siteName || domain}
          </span>
          <ExternalLink size={9} className={isMine ? 'text-white/30 flex-shrink-0' : 'text-zinc-600 flex-shrink-0'} />
        </div>

        {/* Title */}
        {data.title && (
          <p className={`text-xs font-semibold line-clamp-2 leading-tight ${isMine ? 'text-white' : 'text-zinc-200'}`}>
            {data.title}
          </p>
        )}

        {/* Description */}
        {data.description && (
          <p className={`text-[11px] line-clamp-2 leading-tight ${isMine ? 'text-white/60' : 'text-zinc-400'}`}>
            {data.description}
          </p>
        )}
      </div>
    </a>
  );
}
