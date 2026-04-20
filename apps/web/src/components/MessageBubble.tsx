import { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';
import {
  Check,
  CheckCheck,
  Play,
  Pause,
  Download,
  FileText,
  Copy,
  Pencil,
  Trash2,
  Reply,
  Smile,
  MoreHorizontal,
  X,
  Volume2,
  Pin,
  Clock,
  Forward,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { getSocket } from '../lib/socket';
import { useLang } from '../lib/i18n';
import { extractWaveform } from '../lib/utils';
import { getKeyPairSync, decryptMessage as e2eeDecrypt } from '../lib/e2ee';
import { isElectron } from '../lib/electron';
import type { Message, MediaItem, Reaction, ChatMember } from '../lib/types';

// Helper для формирования правильного URL медиа в Electron
const getMediaUrl = (url: string | undefined): string => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  // В Electron используем прямой URL к серверу
  if (isElectron()) {
    const serverUrl = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';
    return `${serverUrl}${url}`;
  }
  return url;
};
import ImageLightbox from './ImageLightbox';
import PollMessage from './PollMessage';
import LinkPreview from './LinkPreview';

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  showAvatar: boolean;
  onViewProfile?: (userId: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onStartSelectionMode?: (id: string) => void;
  onForwardSingle?: (messageId: string) => void;
}

function MessageBubble({
  message,
  isMine,
  showAvatar,
  onViewProfile,
  selectionMode,
  isSelected,
  onToggleSelect,
  onStartSelectionMode,
  onForwardSingle,
}: MessageBubbleProps) {
  const { user } = useAuthStore();
  const { setReplyTo, setEditingMessage, pinnedMessages, chats } = useChatStore();
  const { t, lang } = useLang();
  const [showContext, setShowContext] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [deleteMenuMode, setDeleteMenuMode] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[] | null>(null);
  const [audioError, setAudioError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [quotedText, setQuotedText] = useState<string | null>(null);

  // E2EE: decrypt message content if it's encrypted
  const isE2EE = !!message.content && (message.content.startsWith('e2ee:v3:') || message.content.startsWith('e2ee:v2:') || message.content.startsWith('e2ee:v1:'));

  // Attempt immediate synchronous decrypt from in-memory cache (no flicker)
  const tryDecryptSync = (): string | null => {
    if (!isE2EE || !message.content) return null;
    const kp = getKeyPairSync();
    if (!kp) return null;
    try {
      return e2eeDecrypt(message.content, kp.secretKey, new Uint8Array(32));
    } catch {
      return null;
    }
  };

  const [decryptedContent, setDecryptedContent] = useState<string | null>(tryDecryptSync);

  useEffect(() => {
    if (!isE2EE || !message.content) {
      setDecryptedContent(null);
      return;
    }
    // Already decrypted synchronously — nothing to do
    if (decryptedContent !== null) return;

    // Keypair not in cache yet — load async (only happens on first page load)
    import('../lib/e2ee').then(({ getKeyPair }) => {
      getKeyPair().then(({ keyPair }) => {
        try {
          const plaintext = e2eeDecrypt(message.content!, keyPair.secretKey, new Uint8Array(32));
          setDecryptedContent(plaintext ?? '[🔒 Не удалось расшифровать]');
        } catch {
          setDecryptedContent('[🔒 Ошибка расшифровки]');
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.content]);

  // Прочитано
  const isRead = message.readBy?.some((r) => r.userId !== user?.id);

  const timeStr = new Date(message.createdAt).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Avoid triggering window listener instantly for other menus
    if (selectionMode) {
      onToggleSelect?.(message.id);
      return;
    }
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Check if text is selected inside this bubble
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && bubbleRef.current?.contains(selection?.anchorNode || null)) {
      setQuotedText(text);
    } else {
      setQuotedText(null);
    }

    const menuWidth = 208;
    const menuHeight = 350; // estimate
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;

    setContextPos({ x, y });
    setShowContext(true);
  };

  const handleCopy = () => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
    }
    setShowContext(false);
  };

  const handleReply = () => {
    setReplyTo({ ...message, quote: quotedText });
    setShowContext(false);
    setQuotedText(null);
  };

  const handleEdit = () => {
    setEditingMessage(message);
    setShowContext(false);
  };

  const handleDeleteForAll = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('delete_messages', {
        messageIds: [message.id],
        chatId: message.chatId,
        deleteForAll: true,
      });
    }
    setShowContext(false);
    setDeleteMenuMode(false);
  };

  const handleDeleteForMe = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('delete_messages', {
        messageIds: [message.id],
        chatId: message.chatId,
        deleteForAll: false,
      });
    }
    // Optimistic hide
    useChatStore.getState().hideMessages([message.id], message.chatId);
    setShowContext(false);
    setDeleteMenuMode(false);
  };

  // Имя собеседника для кнопки «Удалить также для ...»
  const chatForDelete = chats.find(c => c.id === message.chatId);
  const otherMemberName = chatForDelete?.type === 'personal'
    ? chatForDelete.members.find(m => m.user.id !== user?.id)?.user.displayName
      || chatForDelete.members.find(m => m.user.id !== user?.id)?.user.username
      || ''
    : '';

  const isPinned = pinnedMessages[message.chatId]?.id === message.id;

  const handlePin = () => {
    const socket = getSocket();
    if (socket) {
      if (isPinned) {
        socket.emit('unpin_message', { messageId: message.id, chatId: message.chatId });
      } else {
        socket.emit('pin_message', { messageId: message.id, chatId: message.chatId });
      }
    }
    setShowContext(false);
  };

  const handleReaction = (emoji: string) => {
    const socket = getSocket();
    if (socket) {
      const existingReaction = message.reactions?.find(
        (r) => r.userId === user?.id && r.emoji === emoji
      );
      if (existingReaction) {
        socket.emit('remove_reaction', { messageId: message.id, chatId: message.chatId, emoji });
      } else {
        socket.emit('add_reaction', { messageId: message.id, chatId: message.chatId, emoji });
      }
    }
    setShowContext(false);
  };

  // Аудио плеер
  const toggleAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // Ensure audio is loaded before playing
      if (audio.readyState < 2) {
        audio.load();
      }
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.error('Audio play error:', err);
        // Try reloading and playing again
        audio.load();
        audio.play().then(() => setIsPlaying(true)).catch(console.error);
      });
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (audio.duration && isFinite(audio.duration) && isFinite(audio.currentTime)) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const onLoadedMetadata = () => {
      if (isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setAudioProgress(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // Extract real waveform from voice audio  
  useEffect(() => {
    const voiceUrl = message.media?.find((m) => m.type === 'voice')?.url;
    if (!voiceUrl) return;
    extractWaveform(voiceUrl, 28).then(setWaveformBars);
  }, [message.media]);

  const formatDuration = (sec: number) => {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Close context menu logic
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showContext) return;
    const hideMenu = (e: MouseEvent) => {
      // Don't close if clicking inside the context menu
      if (contextMenuRef.current?.contains(e.target as Node)) {
        return;
      }
      setShowContext(false);
      setDeleteMenuMode(false);
    };
    window.addEventListener('click', hideMenu, true);
    window.addEventListener('contextmenu', hideMenu, true);
    return () => {
      window.removeEventListener('click', hideMenu, true);
      window.removeEventListener('contextmenu', hideMenu, true);
    };
  }, [showContext]);

  // Deleted message — auto-hide after 5 seconds
  const [deletedVisible, setDeletedVisible] = useState(true);
  useEffect(() => {
    if (message.isDeleted) {
      const timer = setTimeout(() => setDeletedVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [message.isDeleted]);

  if (message.isDeleted) {
    if (!deletedVisible) return null;
    return (
      <motion.div
        initial={{ opacity: 1, height: 'auto' }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, height: 0 }}
        className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1`}
      >
        <div className="px-4 py-2 rounded-2xl text-sm italic text-zinc-600 bg-surface-tertiary/50">
          {t('messageDeleted')}
        </div>
      </motion.div>
    );
  }

  const media = message.media || [];
  const hasImage = media.some((m) => m.type === 'image');
  const hasVoice = message.type === 'voice' || media.some((m) => m.type === 'voice');
  const hasAudio = !hasVoice && (message.type === 'audio' || media.some((m) => m.type === 'audio'));
  const hasFile = media.some((m) => m.type !== 'image' && m.type !== 'voice' && m.type !== 'video' && m.type !== 'audio');
  const hasVideo = media.some((m) => m.type === 'video');
  const isPoll = message.type === 'poll';

  // Группировка реакций
  const reactionGroups: Record<string, { count: number; users: string[]; isMine: boolean }> = {};
  (message.reactions || []).forEach((r) => {
    if (!reactionGroups[r.emoji]) {
      reactionGroups[r.emoji] = { count: 0, users: [], isMine: false };
    }
    reactionGroups[r.emoji].count++;
    reactionGroups[r.emoji].users.push(r.user?.displayName || r.user?.username || '');
    if (r.userId === user?.id) reactionGroups[r.emoji].isMine = true;
  });

  const senderName = message.sender?.displayName || message.sender?.username || '';
  const senderAvatar = message.sender?.avatar;

  // Use decrypted content if available, otherwise raw content
  const displayContent = decryptedContent ?? message.content;

  // Simple Markdown formatter with XSS sanitization
  const renderFormattedText = (text: string) => {
    if (!text) return text;
    // Sanitize input to prevent XSS
    const sanitized = DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
    // Split by *, _, ~, ` blocks and @mentions while keeping the delimiters
    const parts = sanitized.split(/(\*\*[\s\S]*?\*\*|\*[\s\S]*?\*|_[\s\S]*?_|~[\s\S]*?~|`[\s\S]*?`|@\w+)/g);

    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
      if (part.startsWith('_') && part.endsWith('_')) return <em key={i} className="italic">{part.slice(1, -1)}</em>;
      if (part.startsWith('*') && part.endsWith('*')) return <em key={i} className="italic">{part.slice(1, -1)}</em>;
      if (part.startsWith('~') && part.endsWith('~')) return <del key={i} className="line-through opacity-80">{part.slice(1, -1)}</del>;
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="font-mono text-[13px] bg-black/20 px-1 py-0.5 rounded-[0.35rem]">{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('@') && part.length > 1) {
        const mentionUsername = part.slice(1);
        return (
          <span
            key={i}
            className="font-semibold text-sky-300 cursor-pointer hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              // Find userId by username from chat members in store
              const chat = chats.find(c => c.id === message.chatId);
              const members = chat?.members || [];
              const found = members.find((m) => m.user?.username === mentionUsername);
              if (found) {
                onViewProfile?.(found.user.id);
              }
            }}
          >{part}</span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <>
      <div
        ref={bubbleRef}
        className={`flex ${isMine ? 'justify-end' : 'justify-start'} group mb-0.5 relative transition-colors duration-200 ${selectionMode ? 'px-4 -mx-4 cursor-pointer hover:bg-white/5 rounded-xl' : ''
          } ${isSelected ? 'bg-blue-500/10 hover:bg-blue-500/20' : ''}`}
        onClick={() => {
          if (selectionMode) onToggleSelect?.(message.id);
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Selection Checkbox */}
        {selectionMode && (
          <div className="absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-white/30 flex items-center justify-center transition-colors">
            {isSelected && <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
              <Check size={12} className="text-white" />
            </div>}
          </div>
        )}

        {/* Аватар (чужие) */}
        {!isMine && (
          <div className="w-8 flex-shrink-0 mr-2 self-end">
            {showAvatar ? (
              <button onClick={() => onViewProfile?.(message.senderId)}>
                {senderAvatar ? (
                  <img src={senderAvatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-semibold">
                    {senderName[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </button>
            ) : null}
          </div>
        )}

        <div className={`max-w-[65%] min-w-0 ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
          {/* Имя отправителя (для групп) */}
          {!isMine && showAvatar && (
            <button
              className="text-xs font-medium text-blue-400 ml-3 mb-0.5 hover:underline"
              onClick={() => onViewProfile?.(message.senderId)}
            >
              {senderName}
            </button>
          )}

          {/* Reply */}
          {message.replyTo && (
            <div className={`mx-3 mb-1 px-3 py-1.5 rounded-lg border-l-2 border-blue-500 bg-blue-500/10 max-w-full`}>
              <p className="text-xs font-medium text-blue-400 truncate">
                {message.replyTo.sender?.displayName || message.replyTo.sender?.username}
              </p>
              <p className="text-xs text-zinc-400 truncate">{message.quote || message.replyTo.content || t('media')}</p>
            </div>
          )}

          {/* Пузырь */}
          <div
            onContextMenu={handleContextMenu}
            onDoubleClick={handleReply}
            title={t('reply') ? `${t('reply')} (Double Click)` : 'Double click to reply'}
            className={`cursor-pointer rounded-[1.25rem] overflow-hidden transition-all duration-300 ${
              hasImage && !message.content
                ? 'p-0 shadow-none border-none'
                : isMine
                  ? 'bubble-sent text-white shadow-sm px-4 py-2.5 hover:shadow-md hover:brightness-105'
                  : 'bubble-received text-zinc-100 shadow-sm px-4 py-2.5 hover:shadow-md hover:brightness-105'
            }`}
          >
            {/* Рендер пересланного сообщения */}
            {message.forwardedFrom && (
              <div className="mb-2 text-xs opacity-90 border-l-[3px] border-white/30 pl-2">
                <span className="font-medium">{t('forwardedFrom')}: </span>
                {message.forwardedFrom.displayName || message.forwardedFrom.username}
              </div>
            )}

            {/* Изображения */}
            {hasImage && (
              <div className={`${message.content ? 'mb-2 -mx-3 -mt-2' : ''} ${!message.content ? 'rounded-[1.25rem]' : ''} bg-black/40 overflow-hidden`}>
                {media
                  .filter((m) => m.type === 'image')
                  .map((m) => (
                    <img
                      key={m.id}
                      src={getMediaUrl(m.url)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="max-w-full max-h-80 object-cover cursor-pointer hover:brightness-90 transition-all"
                      onClick={() => setLightboxUrl(getMediaUrl(m.url))}
                    />
                  ))}
              </div>
            )}

            {/* Видео */}
            {hasVideo &&
              media
                .filter((m) => m.type === 'video')
                .map((m) => (
                  <div key={m.id} className={`${message.content ? 'mb-2 -mx-3 -mt-2' : ''}`}>
                    <video
                      src={getMediaUrl(m.url)}
                      controls
                      className="max-w-full max-h-80 rounded-lg"
                    />
                  </div>
                ))}

            {/* Голосовое */}
            {hasVoice && (
              <div className="flex items-center gap-3 min-w-[200px]">
                <audio
                  ref={audioRef}
                  src={getMediaUrl(media.find((m) => m.type === 'voice')?.url)}
                  preload="auto"
                  onError={(e) => {
                    console.error('Audio load error:', e);
                    setAudioError(true);
                  }}
                  onLoadStart={() => setAudioError(false)}
                />
                <button
                  onClick={audioError ? undefined : toggleAudio}
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    audioError 
                      ? 'bg-red-500/20 cursor-not-allowed' 
                      : isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-blue-500/20 hover:bg-blue-500/30'
                    } transition-colors`}
                  title={audioError ? 'Ошибка загрузки аудио' : undefined}
                >
                  {audioError ? (
                    <X size={16} className="text-red-400" />
                  ) : isPlaying ? (
                    <Pause size={16} className={isMine ? 'text-white' : 'text-blue-400'} />
                  ) : (
                    <Play size={16} className={`${isMine ? 'text-white' : 'text-blue-400'} ml-0.5`} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  {/* Waveform visualization */}
                  <div
                    className="flex items-end gap-[2px] h-6 cursor-pointer"
                    onClick={(e) => {
                      const audio = audioRef.current;
                      if (!audio || !audio.duration || !isFinite(audio.duration)) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = (e.clientX - rect.left) / rect.width;
                      const newTime = pct * audio.duration;
                      if (isFinite(newTime)) {
                        audio.currentTime = newTime;
                        setAudioProgress(pct * 100);
                        if (!isPlaying) toggleAudio();
                      }
                    }}
                  >
                    {(waveformBars || Array(28).fill(0.5)).map((val, i) => {
                      const barHeight = Math.max(10, val * 100);
                      const progress = audioProgress / 100;
                      const barProgress = i / 28;
                      const isActive = barProgress < progress;
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-full transition-colors duration-150 ${isActive
                            ? isMine ? 'bg-white/80' : 'bg-blue-400'
                            : isMine ? 'bg-white/20' : 'bg-white/10'
                            }`}
                          style={{ height: `${barHeight}%` }}
                        />
                      );
                    })}
                  </div>
                  <span className={`text-xs mt-0.5 block ${isMine ? 'text-white/60' : 'text-zinc-500'}`}>
                    {isPlaying
                      ? formatDuration(audioRef.current?.currentTime || 0)
                      : formatDuration(audioDuration || message.media?.find((m) => m.type === 'voice')?.duration || 0)}
                  </span>
                </div>
              </div>
            )}

            {/* Аудио (mp3 файлы) */}
            {hasAudio && (() => {
              const audioMedia = media.find((m) => m.type === 'audio');
              return (
                <div className="min-w-[220px]">
                  {audioMedia?.filename && (
                    <div className="flex items-center gap-2 mb-2">
                      <Volume2 size={14} className={isMine ? 'text-white/60' : 'text-blue-400'} />
                      <span className={`text-xs truncate ${isMine ? 'text-white/70' : 'text-zinc-400'}`}>{audioMedia.filename}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <audio
                      ref={audioRef}
                      src={getMediaUrl(audioMedia?.url)}
                      preload="auto"
                      onError={(e) => {
                        console.error('Audio load error:', e);
                        setAudioError(true);
                      }}
                      onLoadStart={() => setAudioError(false)}
                    />
                    <button
                      onClick={audioError ? undefined : toggleAudio}
                      className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        audioError 
                          ? 'bg-red-500/20 cursor-not-allowed' 
                          : isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-blue-500/20 hover:bg-blue-500/30'
                        } transition-colors`}
                      title={audioError ? 'Ошибка загрузки аудио' : undefined}
                    >
                      {audioError ? (
                        <X size={16} className="text-red-400" />
                      ) : isPlaying ? (
                        <Pause size={16} className={isMine ? 'text-white' : 'text-blue-400'} />
                      ) : (
                        <Play size={16} className={`${isMine ? 'text-white' : 'text-blue-400'} ml-0.5`} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-[2px] h-6">
                        {Array.from({ length: 28 }).map((_, i) => {
                          const barHeight = [40, 65, 35, 80, 50, 90, 45, 70, 55, 85, 30, 75, 60, 95, 40, 80, 50, 70, 35, 90, 55, 65, 45, 85, 60, 75, 50, 40][i] || 50;
                          const progress = audioProgress / 100;
                          const barProgress = i / 28;
                          const isActive = barProgress < progress;
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-full transition-colors duration-150 ${isActive
                                ? isMine ? 'bg-white/80' : 'bg-blue-400'
                                : isMine ? 'bg-white/20' : 'bg-white/10'
                                }`}
                              style={{ height: `${barHeight}%` }}
                            />
                          );
                        })}
                      </div>
                      <span className={`text-xs mt-0.5 block ${isMine ? 'text-white/60' : 'text-zinc-500'}`}>
                        {isPlaying
                          ? formatDuration(audioRef.current?.currentTime || 0)
                          : formatDuration(audioDuration || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Файлы */}
            {hasFile &&
              media
                .filter((m) => m.type !== 'image' && m.type !== 'voice' && m.type !== 'video')
                .map((m) => (
                  <a
                    key={m.id}
                    href={m.url}
                    download={m.filename || 'file'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-3 p-2 rounded-xl ${isMine ? 'bg-white/10 hover:bg-white/15' : 'bg-surface-tertiary hover:bg-surface-hover'
                      } transition-colors mb-1`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isMine ? 'bg-white/20' : 'bg-blue-500/20'
                      }`}>
                      <FileText size={20} className={isMine ? 'text-white' : 'text-blue-400'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{m.filename || t('fileLabel')}</p>
                      <p className={`text-xs ${isMine ? 'text-white/50' : 'text-zinc-500'}`}>
                        {m.size ? `${(m.size / 1024).toFixed(1)} ${t('kb')}` : t('download')}
                      </p>
                    </div>
                    <Download size={16} className={isMine ? 'text-white/50' : 'text-zinc-500'} />
                  </a>
                ))}

            {/* Опрос */}
            {isPoll && (
              <PollMessage messageId={message.id} isMine={isMine} />
            )}

            {/* Текст */}
            {!isPoll && displayContent && (
              <div className="flex items-end gap-2 min-w-0">
                <p className="text-sm whitespace-pre-wrap break-words flex-1 leading-relaxed overflow-wrap-anywhere">
                  {renderFormattedText(displayContent)}
                </p>
                <span className={`text-[10px] flex-shrink-0 flex items-center gap-0.5 self-end ${isMine ? 'text-white/50' : 'text-zinc-500'
                  }`}>
                  {message.isEdited && <span>{t('edited')}</span>}
                  {message.scheduledAt && <Clock size={11} className="text-amber-400 mr-0.5" />}
                  {timeStr}
                  {isMine && !message.scheduledAt && (
                    isRead ? (
                      <CheckCheck size={13} className="text-sky-300 ml-0.5" />
                    ) : (
                      <Check size={13} className="ml-0.5" />
                    )
                  )}
                </span>
              </div>
            )}

            {/* Link preview — shown for text messages with URLs */}
            {!isPoll && displayContent && (() => {
              const urlMatch = displayContent.match(/https?:\/\/[^\s<>"]+/);
              if (!urlMatch) return null;
              return <LinkPreview key={urlMatch[0]} url={urlMatch[0]} isMine={isMine} />;
            })()}

            {/* Время для медиа без текста */}
            {!message.content && (hasImage || hasVideo) && (
              <div className={`flex justify-end px-3 py-1 ${hasImage ? '-mt-8 relative z-10' : ''}`}>
                <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded-full flex items-center gap-1 backdrop-blur-sm">
                  {timeStr}
                  {isMine && (
                    isRead ? (
                      <CheckCheck size={13} className="text-sky-300" />
                    ) : (
                      <Check size={13} />
                    )
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Реакции */}
          {Object.keys(reactionGroups).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 mx-1">
              {Object.entries(reactionGroups).map(([emoji, data]) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${data.isMine
                    ? 'bg-blue-500/30 border border-blue-500/50'
                    : 'bg-surface-tertiary border border-border hover:border-zinc-600'
                    }`}
                  title={data.users.join(', ')}
                >
                  <span>{emoji}</span>
                  <span className="text-zinc-400">{data.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Аватар (свои) */}
        {isMine && (
          <div className="w-8 flex-shrink-0 ml-2 self-end">
            {showAvatar ? (
              <button onClick={() => onViewProfile?.(message.senderId)}>
                {senderAvatar ? (
                  <img src={senderAvatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-semibold">
                    {senderName[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Контекстное меню */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showContext && (
            <motion.div
              ref={contextMenuRef}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed z-[9999] w-52 rounded-[1.25rem] glass-strong shadow-2xl py-1.5 overflow-hidden border border-white/10"
              style={{ left: contextPos.x, top: contextPos.y }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {deleteMenuMode ? (
                <>
                  {/* Delete submenu */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                    <button
                      onClick={() => setDeleteMenuMode(false)}
                      className="p-1 rounded-lg hover:bg-surface-hover transition-colors text-zinc-400 hover:text-white"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <span className="text-sm font-medium text-zinc-300">{t('delete')}</span>
                  </div>
                  <button
                    onClick={handleDeleteForMe}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                  >
                    <Trash2 size={16} className="text-zinc-400" />
                    {t('deleteForMe')}
                  </button>
                  <button
                    onClick={handleDeleteForAll}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                  >
                    <Trash2 size={16} />
                    {chatForDelete?.type === 'personal' && otherMemberName
                      ? `${t('deleteAlsoFor')} ${otherMemberName}`
                      : t('deleteForAll')}
                  </button>
                </>
              ) : (
                <>
              {/* Быстрые реакции */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
                {['👍', '❤️', '😂', '😮', '😢', '🔥'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover transition-colors text-lg"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <button
                onClick={handleReply}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
              >
                <Reply size={16} />
                {quotedText ? t('replyWithQuote') : t('reply')}
              </button>

              <button
                onClick={() => {
                  setShowContext(false);
                  onStartSelectionMode?.(message.id);
                }}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
              >
                <CheckCheck size={16} />
                {t('select')}
              </button>

              {onForwardSingle && (
                <button
                  onClick={() => {
                    setShowContext(false);
                    onForwardSingle(message.id);
                  }}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                >
                  <Forward size={16} />
                  {t('forward')}
                </button>
              )}

              <button
                onClick={handlePin}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
              >
                <Pin size={16} />
                {isPinned ? t('unpinMessage') : t('pinMessage')}
              </button>

              {message.content && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                >
                  <Copy size={16} />
                  {t('copy')}
                </button>
              )}

              {isMine && message.content && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                >
                  <Pencil size={16} />
                  {t('edit')}
                </button>
              )}

              <div className="border-t border-border my-1" />
              <button
                onClick={() => setDeleteMenuMode(true)}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={16} />
                {t('delete')}
              </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

export default memo(MessageBubble);
