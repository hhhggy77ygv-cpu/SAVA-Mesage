import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { Search, TrendingUp, Loader2 } from 'lucide-react';
import { useLang } from '../lib/i18n';

interface TenorGif {
  id: string;
  media_formats?: {
    gif?: { url: string };
    tinygif?: { url: string };
  };
  content_description?: string;
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSelectGif?: (url: string, preview: string) => void;
  onClose: () => void;
}

const getTenorKey = () => localStorage.getItem('sava_tenor_key') || '';

export default function EmojiPicker({ onSelect, onSelectGif, onClose }: EmojiPickerProps) {
  const { lang, t } = useLang();
  const [tab, setTab] = useState<'emoji' | 'gif'>('emoji');
  const [gifQuery, setGifQuery] = useState('');
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [trendingGifs, setTrendingGifs] = useState<TenorGif[]>([]);
  const gifSearchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load trending GIFs
  useEffect(() => {
    if (tab === 'gif' && getTenorKey() && trendingGifs.length === 0) {
      setGifLoading(true);
      fetch(`https://tenor.googleapis.com/v2/featured?key=${getTenorKey()}&limit=30&media_filter=gif,tinygif`)
        .then(r => r.json())
        .then(d => { setTrendingGifs(d.results || []); setGifLoading(false); })
        .catch(() => setGifLoading(false));
    }
  }, [tab]);

  const searchGifs = useCallback((q: string) => {
    if (!getTenorKey() || !q.trim()) { setGifs([]); return; }
    setGifLoading(true);
    fetch(`https://tenor.googleapis.com/v2/search?key=${getTenorKey()}&q=${encodeURIComponent(q)}&limit=30&media_filter=gif,tinygif`)
      .then(r => r.json())
      .then(d => { setGifs(d.results || []); setGifLoading(false); })
      .catch(() => setGifLoading(false));
  }, []);

  const handleGifSearch = (q: string) => {
    setGifQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchGifs(q), 400);
  };

  const pickGif = (gif: TenorGif) => {
    const url = gif.media_formats?.gif?.url || gif.media_formats?.tinygif?.url || '';
    const preview = gif.media_formats?.tinygif?.url || url;
    if (onSelectGif && url) {
      onSelectGif(url, preview);
    }
  };

  const displayGifs = gifQuery.trim() ? gifs : trendingGifs;

  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const el = anchorRef.current?.parentElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = tab === 'gif' ? 360 : 352;
      let left = rect.right - w;
      if (left < 8) left = 8;
      setPos({ top: rect.top - 8, left });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [tab]);

  const pickerWidth = tab === 'gif' ? 360 : 352;

  return (
    <>
      <div ref={anchorRef} className="hidden" />
      {createPortal(
        <>
          <div className="fixed inset-0 z-[9990]" onClick={onClose} />
          <div
            className="fixed z-[9991] rounded-2xl shadow-2xl border border-white/10"
            style={{
              width: pickerWidth,
              bottom: pos ? `${window.innerHeight - pos.top}px` : undefined,
              left: pos ? pos.left : undefined,
              background: 'rgb(17, 17, 19)',
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab('emoji')}
            className={`flex-1 py-2.5 text-xs font-semibold tracking-wide transition-colors ${tab === 'emoji' ? 'text-white border-b-2 border-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            EMOJI
          </button>
          {(getTenorKey() || onSelectGif) && (
            <button
              onClick={() => { setTab('gif'); setTimeout(() => gifSearchRef.current?.focus(), 100); }}
              className={`flex-1 py-2.5 text-xs font-semibold tracking-wide transition-colors ${tab === 'gif' ? 'text-white border-b-2 border-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              GIF
            </button>
          )}
        </div>

        {/* Emoji tab */}
        {tab === 'emoji' && (
          <Picker
            data={data}
            onEmojiSelect={(e: { native: string }) => onSelect(e.native)}
            theme="dark"
            locale={lang === 'ru' ? 'ru' : 'en'}
            set="native"
            previewPosition="none"
            skinTonePosition="search"
            perLine={9}
            emojiSize={28}
            emojiButtonSize={36}
            maxFrequentRows={2}
            navPosition="bottom"
            dynamicWidth={false}
          />
        )}

        {/* GIF tab */}
        {tab === 'gif' && (
          <div className="flex flex-col h-[calc(100%-41px)]">
            {!getTenorKey() ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <p className="text-sm text-zinc-400 mb-2">{t('tenorKeyRequired')}</p>
                <p className="text-xs text-zinc-500 mb-3">{t('openConsoleRun')}</p>
                <code className="text-xs bg-black/30 px-3 py-1.5 rounded-lg text-vortex-400">
                  localStorage.setItem('sava_tenor_key', 'YOUR_KEY')
                </code>
              </div>
            ) : (
              <>
                <div className="p-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      ref={gifSearchRef}
                      value={gifQuery}
                      onChange={(e) => handleGifSearch(e.target.value)}
                      placeholder={t('searchGifs')}
                      className="w-full pl-8 pr-3 py-2 rounded-lg bg-surface-tertiary/80 text-sm text-white placeholder-zinc-500 border border-border/30 focus:border-accent/50 outline-none transition-colors"
                    />
                  </div>
                </div>
                {!gifQuery.trim() && !gifLoading && (
                  <div className="flex items-center gap-1.5 px-3 pb-1">
                    <TrendingUp size={12} className="text-zinc-500" />
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t('trending')}</span>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-1.5">
                  {gifLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={24} className="text-zinc-500 animate-spin" />
                    </div>
                  ) : displayGifs.length === 0 ? (
                    <p className="text-center text-xs text-zinc-500 py-10">{gifQuery ? t('nothingFound') : ''}</p>
                  ) : (
                    <div className="columns-2 gap-1.5">
                      {displayGifs.map((gif) => (
                        <button
                          key={gif.id}
                          onClick={() => { pickGif(gif); onClose(); }}
                          className="w-full mb-1.5 rounded-lg overflow-hidden hover:opacity-80 transition-opacity block"
                        >
                          <img
                            src={gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url}
                            alt={gif.content_description || 'GIF'}
                            className="w-full h-auto rounded-lg"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
