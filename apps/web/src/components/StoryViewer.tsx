import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Eye, Trash2, Plus, ChevronUp } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { getInitials, generateAvatarColor } from '../lib/utils';
import Avatar from './Avatar';
import { StoryGroup } from '../lib/types';

const API_URL = import.meta.env.VITE_API_URL || '';

const STORY_BG_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9',
  '#3b82f6', '#1e1e2e',
];

interface StoryViewerProps {
  stories: StoryGroup[];
  initialUserIndex: number;
  onClose: () => void;
  onRefresh: () => void;
}

export default function StoryViewer({ stories, initialUserIndex, onClose, onRefresh }: StoryViewerProps) {
  const { user } = useAuthStore();
  const { t } = useLang();
  const [userIndex, setUserIndex] = useState(initialUserIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const viewedRef = useRef<Set<string>>(new Set()); // track viewed in this session
  const [viewOverrides, setViewOverrides] = useState<Record<string, { viewCount: number; viewed: boolean }>>({});

  const STORY_DURATION = 5000; // 5 seconds per story
  const TICK = 50;

  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<Array<{ userId: string; username: string; displayName: string; avatar: string | null; viewedAt: string }>>([]);
  const [viewersLoading, setViewersLoading] = useState(false);

  const currentUser = stories[userIndex];
  const rawStory = currentUser?.stories?.[storyIndex];
  // Merge prop data with local overrides to avoid mutating props
  const currentStory = rawStory ? { ...rawStory, ...viewOverrides[rawStory.id] } : null;

  // Reset when viewer opens with different user
  useEffect(() => {
    setUserIndex(initialUserIndex);
    setStoryIndex(0);
    setProgress(0);
    viewedRef.current.clear();
    setViewOverrides({});
  }, [initialUserIndex]);

  const goNext = useCallback(() => {
    if (!currentUser) return;
    if (storyIndex < currentUser.stories.length - 1) {
      setStoryIndex(s => s + 1);
      setProgress(0);
    } else if (userIndex < stories.length - 1) {
      setUserIndex(u => u + 1);
      setStoryIndex(0);
      setProgress(0);
    } else {
      onClose();
    }
  }, [storyIndex, userIndex, currentUser, stories.length, onClose]);

  const goPrev = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex(s => s - 1);
      setProgress(0);
    } else if (userIndex > 0) {
      setUserIndex(u => u - 1);
      const prevUser = stories[userIndex - 1];
      setStoryIndex(prevUser.stories.length - 1);
      setProgress(0);
    }
  }, [storyIndex, userIndex, stories]);

  const canGoPrev = storyIndex > 0 || userIndex > 0;
  const canGoNext = (currentUser && storyIndex < currentUser.stories.length - 1) || userIndex < stories.length - 1;

  // Mark viewed
  useEffect(() => {
    if (!currentStory || !currentStory.id) return;
    if (currentUser.user.id === user?.id) return;
    if (currentStory.viewed || viewedRef.current.has(currentStory.id)) return;
    viewedRef.current.add(currentStory.id);
    const storyId = currentStory.id;
    const viewCount = currentStory.viewCount || 0;
    api.viewStory(storyId).then(() => {
      setViewOverrides(prev => ({
        ...prev,
        [storyId]: {
          viewCount: viewCount + 1,
          viewed: true,
        },
      }));
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStory?.id, currentUser?.user?.id, user?.id]);

  // Progress timer - use a key to force restart
  useEffect(() => {
    if (paused || !currentStory) return;
    setProgress(0);
    const step = (TICK / STORY_DURATION) * 100;
    timerRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          goNext();
          return 0;
        }
        return prev + step;
      });
    }, TICK);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [storyIndex, userIndex, paused, goNext]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose]);

  const handleDelete = async () => {
    if (!currentStory) return;
    try {
      await api.deleteStory(currentStory.id);
      onRefresh();
      goNext();
    } catch (e) {
      console.error(e);
    }
  };

  if (!currentUser || !currentStory) return null;

  const timeAgo = (date: string) => {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h`;
  };

  const avatarUrl = currentUser.user.avatar
    ? `${API_URL}${currentUser.user.avatar}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Story container */}
      <div
        className="relative w-full max-w-[420px] h-full max-h-[85vh] rounded-2xl overflow-hidden select-none"
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        {/* Story content */}
        {currentStory.type === 'image' && currentStory.mediaUrl ? (
          <div className="w-full h-full bg-black flex items-center justify-center">
            <img
              src={currentStory.mediaUrl.startsWith('http') ? currentStory.mediaUrl : `${API_URL}${currentStory.mediaUrl}`}
              alt="story"
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>
        ) : (
          <div
            className="w-full h-full flex items-center justify-center p-8"
            style={{ background: currentStory.bgColor || '#6366f1' }}
          >
            <p className="text-white text-2xl font-bold text-center leading-relaxed drop-shadow-lg"
              style={{ maxWidth: '90%', wordBreak: 'break-word' }}>
              {currentStory.content}
            </p>
          </div>
        )}

        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
          {currentUser.stories.map((_, i) => (
            <div key={i} className="flex-1 h-[3px] bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-none"
                style={{
                  width: i < storyIndex ? '100%' : i === storyIndex ? `${progress}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-4 left-0 right-0 flex items-center gap-3 px-4 pt-2 z-10">
          <Avatar
            src={avatarUrl}
            name={currentUser.user.displayName || currentUser.user.username}
            size="sm"
            className="ring-2 ring-white/20 rounded-full"
          />
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate drop-shadow">
              {currentUser.user.id === user?.id ? t('myStory') : currentUser.user.displayName || currentUser.user.username}
            </p>
            <p className="text-white/60 text-xs drop-shadow">{timeAgo(currentStory.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            {currentUser.user.id === user?.id && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (showViewers) {
                      setShowViewers(false);
                      setPaused(false);
                    } else {
                      setPaused(true);
                      setShowViewers(true);
                      setViewersLoading(true);
                      api.getStoryViewers(currentStory.id).then(v => {
                        setViewers(v);
                        setViewersLoading(false);
                      }).catch(() => setViewersLoading(false));
                    }
                  }}
                  className="text-white/60 hover:text-white text-xs flex items-center gap-1 transition-colors p-1"
                >
                  <Eye size={12} /> {currentStory.viewCount}
                  <ChevronUp size={10} className={`transition-transform ${showViewers ? 'rotate-180' : ''}`} />
                </button>
                <button onClick={handleDelete} className="text-white/60 hover:text-red-400 transition-colors p-1">
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Left/Right click zones */}
        <div className="absolute inset-0 flex z-[5]">
          <div className="w-1/3 h-full cursor-pointer" onClick={goPrev} />
          <div className="w-1/3 h-full" />
          <div className="w-1/3 h-full cursor-pointer" onClick={goNext} />
        </div>

        {/* Navigation arrows */}
        {canGoPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white/70 hover:bg-white/20 hover:text-white transition-all"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {canGoNext && (
          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white/70 hover:bg-white/20 hover:text-white transition-all"
          >
            <ChevronRight size={20} />
          </button>
        )}

        {/* Viewers panel */}
        <AnimatePresence>
          {showViewers && currentUser.user.id === user?.id && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 z-20 bg-black/90 backdrop-blur-xl rounded-t-2xl border-t border-white/10 max-h-[50%] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-white text-sm font-semibold flex items-center gap-2">
                    <Eye size={14} /> {t('storyViewers')} ({currentStory.viewCount})
                  </h4>
                  <button
                    onClick={() => { setShowViewers(false); setPaused(false); }}
                    className="text-white/60 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                {viewersLoading ? (
                  <div className="text-white/40 text-sm text-center py-4">{t('sending')}</div>
                ) : viewers.length === 0 ? (
                  <div className="text-white/40 text-sm text-center py-4">{t('noViewers')}</div>
                ) : (
                  <div className="space-y-2">
                    {viewers.map((v) => (
                      <div key={v.userId} className="flex items-center gap-3 py-1.5">
                        <Avatar
                          src={v.avatar ? `${API_URL}${v.avatar}` : null}
                          name={v.displayName || v.username}
                          size="sm"
                          className="rounded-full"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">{v.displayName || v.username}</p>
                          <p className="text-white/40 text-xs">@{v.username}</p>
                        </div>
                        <span className="text-white/30 text-xs">{timeAgo(v.viewedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Story creation modal
interface CreateStoryModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateStoryModal({ onClose, onCreated }: CreateStoryModalProps) {
  const { t } = useLang();
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [bgColor, setBgColor] = useState('#6366f1');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
    setMode('image');
  };

  const handleCreate = async () => {
    if (mode === 'text' && !text.trim()) return;
    if (mode === 'image' && !imageFile) return;
    setIsUploading(true);

    try {
      let mediaUrl: string | undefined;
      if (imageFile) {
        const result = await api.uploadFile(imageFile);
        mediaUrl = result.url;
      }

      await api.createStory({
        type: mode,
        content: mode === 'text' ? text.trim() : undefined,
        bgColor: mode === 'text' ? bgColor : undefined,
        mediaUrl,
      });

      onCreated();
      onClose();
    } catch (e) {
      console.error('Create story error:', e);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="w-full max-w-[400px] rounded-2xl glass-strong border border-white/10 overflow-hidden"
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{t('newStory')}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setMode('text')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mode === 'text' ? 'text-vortex-400 border-b-2 border-vortex-400' : 'text-zinc-400'}`}
          >
            {t('textStory')}
          </button>
          <button
            onClick={() => setMode('image')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${mode === 'image' ? 'text-vortex-400 border-b-2 border-vortex-400' : 'text-zinc-400'}`}
          >
            {t('imageStory')}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />

        <div className="p-4">
          {mode === 'text' ? (
            <>
              {/* Preview */}
              <div
                className="w-full h-48 rounded-xl flex items-center justify-center p-4 mb-4 transition-colors"
                style={{ background: bgColor }}
              >
                <p className="text-white text-lg font-bold text-center break-words max-w-full">
                  {text || t('typeYourStory')}
                </p>
              </div>

              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={t('typeYourStory')}
                maxLength={200}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-200 resize-none h-20 mb-3 focus:outline-none focus:border-vortex-500/50"
              />

              {/* Color picker */}
              <div className="flex flex-wrap gap-2 mb-3">
                {STORY_BG_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setBgColor(c)}
                    className={`w-7 h-7 rounded-full transition-transform ${bgColor === c ? 'scale-125 ring-2 ring-white/50' : 'hover:scale-110'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              {imagePreview ? (
                <div className="relative w-full h-48 rounded-xl mb-4 overflow-hidden">
                  <img src={imagePreview} className="w-full h-full object-cover" alt="preview" />
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(null); }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-48 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center mb-4 text-zinc-400 hover:text-white hover:border-white/40 transition-colors"
                >
                  <Plus size={32} />
                </button>
              )}
            </>
          )}

          <button
            onClick={handleCreate}
            disabled={isUploading || (mode === 'text' && !text.trim()) || (mode === 'image' && !imageFile)}
            className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isUploading ? '...' : t('publishStory')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
