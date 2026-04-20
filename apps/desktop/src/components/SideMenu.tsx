import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User,
  Users,
  Settings,
  Languages,
  Info,
  LogOut,
  ArrowLeft,
  Camera,
  Edit3,
  Check,
  Loader2,
  Trash2,
  Calendar,
  AtSign,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Palette,
  Sparkles,
  UserPlus,
  UserMinus,
  UserCheck,
  Clock,
  Search,
  Shield,
  Eye,
  Smile,
  BellOff,
  Monitor,
  Type,
  LayoutList,
  Ban,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useLang } from '../lib/i18n';
import { useThemeStore, ChatTheme } from '../stores/themeStore';
import { useDisplayStore, FontSize } from '../stores/displayStore';
import DatePicker from './DatePicker';
import SessionsView from './SessionsView';
import type { User as UserType, UserPresence, FriendRequest, FriendWithId } from '../lib/types';

type SideView = 'main' | 'profile' | 'settings' | 'about' | 'themes' | 'friends' | 'sessions' | 'blocked';

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SideMenu({ isOpen, onClose }: SideMenuProps) {
  const { user, updateUser, logout } = useAuthStore();
  const { clearStore } = useChatStore();
  const { chatTheme, setChatTheme } = useThemeStore();
  const { fontSize, compactMode, setFontSize, setCompactMode } = useDisplayStore();
  const { t, lang, setLang } = useLang();

  const [view, setView] = useState<SideView>('main');
  const [prevView, setPrevView] = useState<SideView>('main');
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [birthday, setBirthday] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [themeIndex, setThemeIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Friends state
  const [friends, setFriends] = useState<FriendWithId[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<UserPresence[]>([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);

  const themeCards: { id: ChatTheme; color: string; accent: string; name: string; nameEn: string; desc: string; descEn: string; animated?: boolean; gradient?: string }[] = [
    { id: 'midnight', color: '#0f0f13', accent: '#6366f1', name: 'Полночь', nameEn: 'Midnight', desc: 'Тёмная тема с мягкими акцентами', descEn: 'Dark theme with soft accents' },
    { id: 'ocean', color: '#0b172a', accent: '#3b82f6', name: 'Океан', nameEn: 'Ocean', desc: 'Глубокий синий с прохладными тонами', descEn: 'Deep blue with cool tones' },
    { id: 'forest', color: '#0f1c15', accent: '#10b981', name: 'Лес', nameEn: 'Forest', desc: 'Природный зелёный и спокойствие', descEn: 'Natural green and serenity' },
    { id: 'sunset', color: '#1f111a', accent: '#ec4899', gradient: 'linear-gradient(135deg, #1f111a, #150a0f)', name: 'Закат', nameEn: 'Sunset', desc: 'Тёплый розовый градиент заката', descEn: 'Warm pink sunset gradient' },
    { id: 'classic', color: '#121215', accent: '#a1a1aa', name: 'Классика', nameEn: 'Classic', desc: 'Минималистичная монохромная тема', descEn: 'Minimalist monochrome theme' },
    { id: 'neon', color: '#0b0f19', accent: '#8b5cf6', name: 'Неон', nameEn: 'Neon', desc: 'Фиолетовое свечение за курсором', descEn: 'Purple glow follows your cursor', animated: true },
    { id: 'aurora', color: '#022c22', accent: '#10b981', gradient: 'linear-gradient(135deg, #022c22, #064e3b)', name: 'Аврора', nameEn: 'Aurora', desc: 'Северное сияние реагирует на мышь', descEn: 'Northern lights react to mouse', animated: true },
    { id: 'cyber', color: '#000000', accent: '#f59e0b', name: 'Кибер', nameEn: 'Cyber', desc: 'Сетка и янтарное свечение мыши', descEn: 'Grid pattern with amber glow', animated: true },
    { id: 'glass', color: '#0d1117', accent: '#3b82f6', name: 'Стекло', nameEn: 'Glass', desc: 'Плавное свечение следует за мышью', descEn: 'Smooth glow follows the cursor', animated: true },
    { id: 'void', color: '#000000', accent: '#ffffff', name: 'Бездна', nameEn: 'Void', desc: 'Абсолютный мрак с точечным светом', descEn: 'Absolute darkness with spot light', animated: true },
  ];

  const changeView = (next: SideView) => {
    setPrevView(view);
    setView(next);
    if (next === 'themes') {
      const idx = themeCards.findIndex(tc => tc.id === chatTheme);
      if (idx >= 0) setThemeIndex(idx);
    }
    if (next === 'friends') {
      loadFriends();
    }
  };

  const loadFriends = async () => {
    setFriendsLoading(true);
    try {
      const [friendsList, requests] = await Promise.all([
        api.getFriends(),
        api.getFriendRequests(),
      ]);
      setFriends(friendsList);
      setFriendRequests(requests);
    } catch (e) {
      console.error('Load friends error:', e);
    } finally {
      setFriendsLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    try {
      await api.acceptFriendRequest(requestId);
      const req = friendRequests.find(r => r.id === requestId);
      if (req) {
        const socket = getSocket();
        if (socket) socket.emit('friend_accepted', { friendId: req.user.id });
      }
      loadFriends();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    try {
      await api.declineFriendRequest(requestId);
      setFriendRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveFriend = async (friendshipId: string) => {
    try {
      const friend = friends.find(f => f.friendshipId === friendshipId);
      await api.removeFriend(friendshipId);
      if (friend) {
        const socket = getSocket();
        if (socket) socket.emit('friend_removed', { friendId: friend.id });
      }
      setFriends(prev => prev.filter(f => f.friendshipId !== friendshipId));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendFriendRequest = async (friendId: string) => {
    try {
      const result = await api.sendFriendRequest(friendId);
      const socket = getSocket();
      if (socket) socket.emit('friend_request', { friendId });
      // If auto-accepted (they already sent us a request), reload friends
      if (result.status === 'accepted') {
        loadFriends();
      }
      // Remove from search results
      setFriendSearchResults(prev => prev.filter(u => u.id !== friendId));
    } catch (e) {
      console.error(e);
    }
  };

  // Friend search effect
  useEffect(() => {
    const raw = friendSearch.trim();
    const q = raw.startsWith('@') ? raw.slice(1) : raw;
    if (q.length < 3) {
      setFriendSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setFriendSearchLoading(true);
        const results = await api.searchUsers(q);
        // Filter out self and already-friends
        const friendIds = new Set(friends.map(f => f.id));
        setFriendSearchResults(results.filter(u => u.id !== user?.id && !friendIds.has(u.id)));
      } catch (e) {
        console.error(e);
      } finally {
        setFriendSearchLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [friendSearch, friends, user?.id]);

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => { setView('main'); setPrevView('main'); }, 300);
      setIsEditing(false);
      setFriendSearch('');
      setFriendSearchResults([]);
      return () => clearTimeout(timer);
    }
    // Load friend request count when menu opens
    api.getFriendRequests().then(setFriendRequests).catch(() => {});
  }, [isOpen]);

  // Real-time friend updates via socket
  const loadFriendsRef = useRef(loadFriends);
  loadFriendsRef.current = loadFriends;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onFriendRequestReceived = () => {
      // Reload friend requests when a new request arrives
      api.getFriendRequests().then(setFriendRequests).catch(() => {});
    };

    const onFriendRequestAccepted = () => {
      // Someone accepted our request — reload friends
      loadFriendsRef.current();
    };

    const onFriendRemoved = (data: { userId: string }) => {
      // Remove this user from our friends list
      setFriends(prev => prev.filter(f => f.id !== data.userId));
    };

    socket.on('friend_request_received', onFriendRequestReceived);
    socket.on('friend_request_accepted', onFriendRequestAccepted);
    socket.on('friend_removed', onFriendRemoved);

    return () => {
      socket.off('friend_request_received', onFriendRequestReceived);
      socket.off('friend_request_accepted', onFriendRequestAccepted);
      socket.off('friend_removed', onFriendRemoved);
    };
  }, []);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setBio(user.bio || '');
      setBirthday(user.birthday || '');
    }
  }, [user]);

  const handleLogout = () => {
    clearStore();
    logout();
    onClose();
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const updated = await api.updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        birthday: birthday || undefined,
      });
      updateUser(updated);
      setIsEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUploading(true);
      const updated = await api.uploadAvatar(file);
      updateUser(updated);
    } catch (err) {
      console.error(err);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setAvatarUploading(true);
      await api.removeAvatar();
      updateUser({ avatar: null });
    } catch (err) {
      console.error(err);
    } finally {
      setAvatarUploading(false);
    }
  };

  const initials = (user?.displayName || user?.username || '??')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const menuItems = [
    { icon: User, label: t('myProfile'), onClick: () => changeView('profile') },
    { icon: Users, label: t('friends'), onClick: () => changeView('friends'), badge: friendRequests.length > 0 ? friendRequests.length : undefined },
    { icon: Settings, label: t('settings'), onClick: () => changeView('settings') },
    { divider: true },
    { icon: Info, label: t('aboutApp'), subtitle: 'SAVA Messenger v1.0', onClick: () => changeView('about') },
  ];

  // Slide direction for animations
  const slideDir = prevView === 'main' ? 1 : -1;
  const viewVariants = {
    enter: (dir: number) => ({ x: dir * 100, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: -dir * 100, opacity: 0 }),
  };

  // ======= MAIN VIEW =======
  const renderMain = () => (
    <motion.div key="main" className="flex flex-col h-full" initial={false} animate="center" exit="exit" variants={viewVariants} custom={-1} transition={{ duration: 0.2 }}>
      {/* ── Premium header with avatar ── */}
      <div className="relative overflow-hidden flex-shrink-0">
        {/* Animated gradient backdrop */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/40 via-blue-700/25 to-transparent pointer-events-none" />
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-blue-500/15 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-blue-700/10 rounded-full blur-[60px] pointer-events-none" />

        <div className="relative p-6 pb-5">
          <div className="flex items-start justify-between mb-5">
            {/* Avatar with glow ring */}
            <div className="relative group cursor-pointer" onClick={() => changeView('profile')}>
              <div className="absolute -inset-1 bg-gradient-to-r from-accent via-blue-600 to-accent rounded-full opacity-60 blur group-hover:opacity-90 transition duration-500 animate-[spin_4s_linear_infinite]" />
              <div className="relative">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="w-[72px] h-[72px] rounded-full object-cover ring-[3px] ring-surface" />
                ) : (
                  <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-surface to-surface-secondary flex items-center justify-center ring-[3px] ring-surface relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-tr from-accent/20 to-blue-600/20" />
                    <span className="relative z-10 text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-400 drop-shadow-md">{initials}</span>
                  </div>
                )}
              </div>
              {/* Online indicator */}
              <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-full ring-[3px] ring-surface shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all backdrop-blur-sm">
              <X size={20} />
            </button>
          </div>
          {/* Name & username */}
          <h3 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 tracking-tight leading-tight">
            {user?.displayName || user?.username}
          </h3>
          <div className="flex items-center gap-1.5 mt-1.5">
            <AtSign size={12} className="text-blue-400" />
            <span className="text-sm font-medium text-blue-100/70">{user?.username}</span>
          </div>
          {(user?.statusEmoji || user?.statusText) && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {user.statusEmoji && <span className="text-sm">{user.statusEmoji}</span>}
              {user.statusText && <span className="text-xs text-zinc-400">{user.statusText}</span>}
            </div>
          )}
        </div>
        {/* Bottom fade line */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      {/* ── Menu items ── */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {menuItems.map((item, i) => {
          if ('divider' in item) return <div key={i} className="my-2 mx-2 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />;
          const Icon = item.icon!;
          return (
            <button
              key={i}
              onClick={item.onClick}
              className="group w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-left transition-all duration-200 hover:bg-white/[0.06] active:scale-[0.98]"
            >
              <div className="w-9 h-9 rounded-xl bg-white/[0.06] group-hover:bg-blue-500/15 flex items-center justify-center transition-all duration-200 border border-white/[0.04] group-hover:border-blue-500/20">
                <Icon size={17} className="text-zinc-400 group-hover:text-blue-400 transition-colors duration-200" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-zinc-200 group-hover:text-white transition-colors">{item.label}</p>
                {item.subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{item.subtitle}</p>}
              </div>
              {'badge' in item && item.badge ? (
                <span className="bg-gradient-to-r from-blue-500 to-blue-700 text-white text-[11px] font-bold min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(168,85,247,0.4)]">
                  {item.badge}
                </span>
              ) : (
                <ChevronRight size={15} className="text-zinc-600 group-hover:text-zinc-400 transition-colors flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Logout button ── */}
      <div className="px-3 pb-4 pt-1">
        <div className="h-px bg-gradient-to-r from-transparent via-white/8 to-transparent mb-3" />
        <button
          onClick={handleLogout}
          className="group w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all duration-200 hover:bg-red-500/[0.08] active:scale-[0.98]"
        >
          <div className="w-9 h-9 rounded-xl bg-red-500/[0.08] group-hover:bg-red-500/15 flex items-center justify-center transition-all duration-200 border border-red-500/[0.06] group-hover:border-red-500/20">
            <LogOut size={17} className="text-red-400/70 group-hover:text-red-400 transition-colors duration-200" />
          </div>
          <span className="text-[13.5px] font-medium text-red-400/70 group-hover:text-red-400 transition-colors">{t('logout')}</span>
        </button>
      </div>
    </motion.div>
  );

  // ======= PROFILE VIEW =======
  const renderProfile = () => (
    <motion.div key="profile" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/5 relative overflow-hidden flex-shrink-0">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-600/10 pointer-events-none" />
        <div className="flex items-center gap-3 relative z-10">
          <button onClick={() => { changeView('main'); setIsEditing(false); }} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h3 className="text-lg font-bold tracking-tight text-white drop-shadow-sm">{t('myProfile')}</h3>
        </div>
        {!isEditing ? (
          <button onClick={() => setIsEditing(true)} className="relative z-10 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-all border border-white/5">
            <Edit3 size={16} />
          </button>
        ) : (
          <button onClick={handleSave} disabled={isSaving} className="relative z-10 p-2 rounded-full text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-all border border-blue-500/20">
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Avatar section */}
        <div className="flex flex-col items-center pt-8 pb-4 px-6 relative overflow-visible">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

          <div className="relative group">
            {/* Spinning gradient glow ring */}
            <div className="absolute -inset-1 bg-gradient-to-r from-accent via-blue-600 to-accent rounded-full opacity-50 blur group-hover:opacity-75 transition duration-500 animate-[spin_4s_linear_infinite]" />

            <div className="relative">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-28 h-28 rounded-full object-cover ring-4 ring-surface bg-surface" />
              ) : (
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-surface to-surface-secondary flex items-center justify-center text-white font-bold text-3xl ring-4 ring-surface relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-tr from-accent/20 to-blue-600/20" />
                  <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-400 drop-shadow-md">{initials}</span>
                </div>
              )}
            </div>

            {/* Upload overlay */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute inset-x-1 bottom-1 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 text-xs font-medium text-white transition-all transform translate-y-2 group-hover:translate-y-0"
            >
              {avatarUploading ? (
                <Loader2 size={14} className="text-blue-400 animate-spin" />
              ) : (
                <Camera size={14} className="text-blue-400" />
              )}
            </button>

            {/* Remove avatar button */}
            {user?.avatar && (
              <button
                onClick={handleRemoveAvatar}
                disabled={avatarUploading}
                className="absolute h-7 px-2.5 -top-1 left-1/2 -translate-x-1/2 bg-red-500/80 backdrop-blur-md hover:bg-red-500 rounded-full flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] border border-red-400/30 transform -translate-y-2 group-hover:translate-y-0"
              >
                <Trash2 size={10} className="text-white" />
                <span className="text-[10px] font-semibold text-white">{t('removePhoto')}</span>
              </button>
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>

          {/* Name */}
          {isEditing ? (
            <div className="mt-5 w-full max-w-[260px] relative">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl opacity-50 blur-sm pointer-events-none" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('enterName')}
                className="relative text-lg font-bold text-center text-white bg-black/40 border border-white/20 outline-none px-4 py-2.5 w-full rounded-2xl transition-colors focus:bg-black/60 focus:border-blue-400 placeholder-white/30"
              />
            </div>
          ) : (
            <h3 className="mt-4 text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 tracking-tight text-center px-4">
              {user?.displayName || user?.username}
            </h3>
          )}

          {/* Username badge */}
          <div className="flex items-center gap-1.5 mt-2 bg-blue-500/10 hover:bg-blue-500/20 transition-colors px-3.5 py-1.5 rounded-full border border-blue-500/20 backdrop-blur-sm cursor-default">
            <AtSign size={13} className="text-blue-400" />
            <span className="text-sm font-semibold text-blue-100">{user?.username}</span>
          </div>
        </div>

        {/* Info cards */}
        <div className="px-4 space-y-2.5 pb-6">
          {/* About */}
          <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl p-4 transition-all hover:bg-black/30 hover:border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                <Edit3 size={12} className="text-blue-400" />
              </div>
              <span className="text-xs font-semibold text-blue-200/50 uppercase tracking-widest">{t('aboutMe')}</span>
            </div>
            {isEditing ? (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="w-full rounded-xl bg-black/40 text-sm text-white placeholder-white/30 p-3 border border-white/10 focus:border-blue-500 transition-colors resize-none outline-none leading-relaxed"
                placeholder={t('tellAboutYourself')}
              />
            ) : (
              <p className="text-sm text-zinc-200 leading-relaxed pl-1">
                {user?.bio || <span className="text-white/30 italic">{t('notSpecified')}</span>}
              </p>
            )}
          </div>

          {/* Birthday */}
          <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl p-4 transition-all hover:bg-black/30 hover:border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
                <Calendar size={12} className="text-orange-400" />
              </div>
              <span className="text-xs font-semibold text-orange-200/50 uppercase tracking-widest">{t('birthday')}</span>
            </div>
            {isEditing ? (
              <DatePicker value={birthday} onChange={setBirthday} />
            ) : (
              <p className="text-sm text-zinc-200 pl-1">
                {user?.birthday ? (
                  new Date(user.birthday).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
                ) : (
                  <span className="text-white/30 italic">{t('notSpecified')}</span>
                )}
              </p>
            )}
          </div>

          {/* Member since */}
          {user?.createdAt && (
            <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl p-4 transition-all hover:bg-black/30 hover:border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                  <Check size={12} className="text-emerald-400" />
                </div>
                <span className="text-xs font-semibold text-emerald-200/50 uppercase tracking-widest">{t('onVortexSince')}</span>
              </div>
              <p className="text-sm text-zinc-200 pl-1">
                {new Date(user.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        {isEditing && (
          <div className="px-4 pb-6 flex gap-3">
            <button
              onClick={() => { setIsEditing(false); setDisplayName(user?.displayName || ''); setBio(user?.bio || ''); setBirthday(user?.birthday || ''); }}
              className="flex-1 py-3 rounded-xl bg-black/20 hover:bg-black/40 border border-white/5 text-sm font-semibold text-zinc-300 hover:text-white transition-all backdrop-blur-md"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-purple-700 text-sm font-bold text-white transition-all shadow-[0_0_20px_rgba(168,85,247,0.4)] flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {t('save')}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );

  // ======= SETTINGS VIEW =======
  const [statusEmoji, setStatusEmoji] = useState(user?.statusEmoji || '');
  const [statusText, setStatusText] = useState(user?.statusText || '');
  const [dndEnabled, setDndEnabled] = useState(user?.dndEnabled || false);
  const [dndFrom, setDndFrom] = useState(user?.dndFrom || '23:00');
  const [dndTo, setDndTo] = useState(user?.dndTo || '08:00');
  const [blockedUsers, setBlockedUsers] = useState<Array<{ id: string; username: string; displayName: string; avatar: string | null }>>([]);

  const saveStatus = async () => {
    try {
      const updated = await api.setStatus(statusEmoji || null, statusText || null);
      updateUser(updated);
    } catch (e) { console.error(e); }
  };

  const saveDnd = async (enabled: boolean) => {
    try {
      setDndEnabled(enabled);
      const updated = await api.setDnd(enabled, dndFrom, dndTo);
      updateUser(updated);
    } catch (e) { console.error(e); }
  };

  const loadBlocked = async () => {
    try {
      const list = await api.getBlockedUsers();
      setBlockedUsers(list);
    } catch (e) { console.error(e); }
  };

  const handleUnblock = async (userId: string) => {
    try {
      const result = await api.unblockUser(userId);
      setBlockedUsers(prev => prev.filter(u => u.id !== userId));
      // Update authStore so ChatView re-renders immediately
      updateUser({ blockedUserIds: JSON.stringify(result.blockedUserIds) });
      // Notify the unblocked user via socket
      const socket = getSocket();
      if (socket) socket.emit('user_unblocked', { targetUserId: userId });
    } catch (e) { console.error(e); }
  };

  const renderSettings = () => (
    <motion.div key="settings" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="h-14 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <button onClick={() => changeView('main')} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h3 className="text-sm font-semibold text-white flex-1">{t('settings')}</h3>
      </div>
      <div className="flex-1 overflow-y-auto py-2 space-y-1">

        {/* ── Theme ── */}
        <div className="px-4 pt-2">
          <button onClick={() => changeView('themes')} className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-surface-tertiary/50 hover:bg-surface-hover transition-colors group">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: themeCards.find(tc => tc.id === chatTheme)?.accent || '#6366f1' }}>
              <Palette size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-zinc-200">{t('theme')}</p>
              <p className="text-xs text-zinc-500">{lang === 'ru' ? themeCards.find(tc => tc.id === chatTheme)?.name : themeCards.find(tc => tc.id === chatTheme)?.nameEn}</p>
            </div>
            <ChevronRight size={18} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
          </button>
        </div>

        {/* ── Compact mode ── */}
        <div className="px-5 pt-3">
          <button onClick={() => setCompactMode(!compactMode)}
            className="w-full flex items-center gap-4 px-3 py-3 rounded-xl bg-surface-tertiary/50 hover:bg-surface-hover transition-colors">
            <LayoutList size={18} className="text-zinc-400 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm text-zinc-200">Компактный режим</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Меньше отступов, больше сообщений</p>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${compactMode ? 'bg-blue-500' : 'bg-zinc-600'}`}>
              <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${compactMode ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </button>
        </div>

        {/* ── Language ── */}
        <div className="px-5 pt-3">
          <h4 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">{t('language')}</h4>
          <div className="flex gap-2">
            {(['ru', 'en'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl transition-colors ${lang === l ? 'bg-blue-500/15 ring-1 ring-blue-500/30' : 'bg-surface-tertiary/50 hover:bg-surface-hover'}`}>
                <span>{l === 'ru' ? '🇷🇺' : '🇬🇧'}</span>
                <span className="text-sm text-zinc-200">{l === 'ru' ? 'Русский' : 'English'}</span>
                {lang === l && <Check size={14} className="text-blue-400 ml-auto" />}
              </button>
            ))}
          </div>
        </div>

        {/* ── Blocked users ── */}
        <div className="px-5 pt-3">
          <button onClick={() => { changeView('blocked'); loadBlocked(); }}
            className="w-full flex items-center gap-4 px-3 py-3 rounded-xl bg-surface-tertiary/50 hover:bg-surface-hover transition-colors group">
            <Ban size={18} className="text-zinc-400 flex-shrink-0" />
            <div className="flex-1 text-left">
              <p className="text-sm text-zinc-200">Заблокированные</p>
            </div>
            <ChevronRight size={16} className="text-zinc-500 group-hover:text-zinc-300" />
          </button>
        </div>

        {/* ── Sessions ── */}
        <div className="px-5 pt-3 pb-4">
          <button onClick={() => changeView('sessions')}
            className="w-full flex items-center gap-4 px-3 py-3 rounded-xl bg-surface-tertiary/50 hover:bg-surface-hover transition-colors group">
            <Monitor size={18} className="text-zinc-400 flex-shrink-0" />
            <div className="flex-1 text-left">
              <p className="text-sm text-zinc-200">Активные сессии</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Устройства, где вы вошли</p>
            </div>
            <ChevronRight size={16} className="text-zinc-500 group-hover:text-zinc-300" />
          </button>
        </div>

      </div>
    </motion.div>
  );

  // ======= SESSIONS VIEW =======
  const renderSessions = () => (
    <motion.div key="sessions" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="h-14 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <button onClick={() => changeView('settings')} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h3 className="text-sm font-semibold text-white flex-1">Активные сессии</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <SessionsView />
      </div>
    </motion.div>
  );

  // ======= BLOCKED VIEW =======
  const renderBlocked = () => (
    <motion.div key="blocked" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="h-14 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <button onClick={() => changeView('settings')} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h3 className="text-sm font-semibold text-white flex-1">Заблокированные</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {blockedUsers.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-8">Нет заблокированных пользователей</p>
        ) : (
          <div className="space-y-2">
            {blockedUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                {u.avatar ? <img src={u.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                  : <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-white font-bold text-sm">{(u.displayName || u.username)[0].toUpperCase()}</div>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{u.displayName || u.username}</p>
                  <p className="text-xs text-zinc-500">@{u.username}</p>
                </div>
                <button onClick={() => handleUnblock(u.id)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded-lg hover:bg-blue-500/10">
                  Разблокировать
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );

  // ======= THEMES VIEW =======
  const renderThemes = () => {
    const currentCard = themeCards[themeIndex];
    const isActive = chatTheme === currentCard.id;
    return (
      <motion.div key="themes" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
        <div className="h-14 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
          <button onClick={() => changeView('settings')} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h3 className="text-sm font-semibold text-white flex-1">{t('theme')}</h3>
          <span className="text-xs text-zinc-500 tabular-nums">{themeIndex + 1} / {themeCards.length}</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-5 py-4 gap-4 overflow-hidden">
          {/* Preview card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentCard.id}
              initial={{ opacity: 0, scale: 0.92, x: 40 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.92, x: -40 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="w-full rounded-2xl overflow-hidden border border-border/40 shadow-xl flex flex-col"
              style={{ minHeight: 200 }}
            >
              {/* Theme background preview */}
              <div
                className={`relative w-full h-32 chat-theme-${currentCard.id}`}
                style={currentCard.gradient ? { background: currentCard.gradient } : { backgroundColor: currentCard.color }}
              >
                {/* Fake chat bubbles */}
                <div className="absolute inset-0 p-4 flex flex-col justify-end gap-2">
                  <div className="self-start max-w-[65%] px-3 py-2 rounded-2xl rounded-bl-md bg-white/10 backdrop-blur-sm">
                    <p className="text-[11px] text-white/70">Hey! How's it going? 👋</p>
                  </div>
                  <div className="self-end max-w-[65%] px-3 py-2 rounded-2xl rounded-br-md" style={{ backgroundColor: currentCard.accent + '40' }}>
                    <p className="text-[11px] text-white/80">Pretty great, thanks! ✨</p>
                  </div>
                </div>
                {currentCard.animated && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 backdrop-blur-sm">
                    <Sparkles size={10} className="text-yellow-400" />
                    <span className="text-[9px] text-white/60 font-medium">{lang === 'ru' ? 'Интерактив' : 'Interactive'}</span>
                  </div>
                )}
              </div>
              {/* Info */}
              <div className="p-4 bg-surface-secondary">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentCard.accent }} />
                  <h3 className="text-base font-bold text-white">{lang === 'ru' ? currentCard.name : currentCard.nameEn}</h3>
                </div>
                <p className="text-xs text-zinc-400 ml-6">{lang === 'ru' ? currentCard.desc : currentCard.descEn}</p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation arrows + select */}
          <div className="flex items-center gap-3 w-full">
            <button
              onClick={() => setThemeIndex(i => (i - 1 + themeCards.length) % themeCards.length)}
              className="p-2.5 rounded-xl bg-surface-tertiary/60 text-zinc-400 hover:text-white hover:bg-surface-hover transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => { setChatTheme(currentCard.id); }}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${isActive
                ? 'bg-accent/20 text-accent ring-1 ring-accent/40 cursor-default'
                : 'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
                }`}
              disabled={isActive}
            >
              {isActive ? (lang === 'ru' ? '✓ Выбрано' : '✓ Selected') : (lang === 'ru' ? 'Применить' : 'Apply')}
            </button>
            <button
              onClick={() => setThemeIndex(i => (i + 1) % themeCards.length)}
              className="p-2.5 rounded-xl bg-surface-tertiary/60 text-zinc-400 hover:text-white hover:bg-surface-hover transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {themeCards.map((tc, i) => (
              <button
                key={tc.id}
                onClick={() => setThemeIndex(i)}
                className={`rounded-full transition-all duration-200 ${i === themeIndex
                  ? 'w-6 h-2 bg-accent'
                  : chatTheme === tc.id
                    ? 'w-2 h-2 bg-accent/50'
                    : 'w-2 h-2 bg-zinc-600 hover:bg-zinc-500'
                  }`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  // ======= FRIENDS VIEW =======
  const renderFriends = () => (
    <motion.div key="friends" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="h-14 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <button onClick={() => { changeView('main'); setFriendSearch(''); setFriendSearchResults([]); }} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h3 className="text-sm font-semibold text-white flex-1">{t('friends')}</h3>
      </div>

      {/* Search bar */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder={t('searchFriends')}
            value={friendSearch}
            onChange={(e) => setFriendSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface-tertiary text-sm text-white placeholder-zinc-500 border border-border focus:border-accent transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {friendsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-zinc-400" />
          </div>
        ) : (
          <>
            {/* Search results */}
            {friendSearch.trim().length > 0 && (
              <div className="px-4 pt-2 pb-2">
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                  <Search size={12} className="inline mr-1" />{t('searchFriends').split('(')[0].trim()}
                </h4>
                {(() => {
                  const raw = friendSearch.trim();
                  const q = raw.startsWith('@') ? raw.slice(1) : raw;
                  if (q.length < 3) {
                    return <p className="text-xs text-zinc-500 text-center py-3">{t('minCharsHint')}</p>;
                  }
                  if (friendSearchLoading) {
                    return (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 size={18} className="animate-spin text-zinc-400" />
                      </div>
                    );
                  }
                  if (friendSearchResults.length === 0) {
                    return <p className="text-xs text-zinc-500 text-center py-3">{t('noSearchResults')}</p>;
                  }
                  return (
                    <div className="space-y-1">
                      {friendSearchResults.map((u) => (
                        <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-border/50">
                          {u.avatar ? (
                            <img src={u.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm">
                              {(u.displayName || u.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{u.displayName || u.username}</p>
                            <p className="text-xs text-zinc-500">@{u.username}</p>
                          </div>
                          <button
                            onClick={() => handleSendFriendRequest(u.id)}
                            className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                            title={t('addFriend')}
                          >
                            <UserPlus size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Incoming requests */}
            {friendRequests.length > 0 && (
              <div className="px-4 pt-4 pb-2">
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                  {t('friendRequests')} ({friendRequests.length})
                </h4>
                <div className="space-y-2">
                  {friendRequests.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-border/50">
                      {req.user.avatar ? (
                        <img src={req.user.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm">
                          {(req.user.displayName || req.user.username || '?')[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{req.user.displayName || req.user.username}</p>
                        <p className="text-xs text-zinc-500">@{req.user.username}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleAcceptRequest(req.id)}
                          className="p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                          title={t('accept')}
                        >
                          <UserCheck size={16} />
                        </button>
                        <button
                          onClick={() => handleDeclineRequest(req.id)}
                          className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                          title={t('decline')}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Friends list */}
            <div className="px-4 pt-4 pb-2">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                {t('friendsList')} ({friends.length})
              </h4>
              {friends.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-8">{t('noFriends')}</p>
              ) : (
                <div className="space-y-1">
                  {friends.map((friend) => (
                    <div key={friend.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group/friend">
                      <div className="relative">
                        {friend.avatar ? (
                          <img src={friend.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm">
                            {(friend.displayName || friend.username || '?')[0].toUpperCase()}
                          </div>
                        )}
                        {friend.isOnline && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-surface-secondary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{friend.displayName || friend.username}</p>
                        <p className="text-xs text-zinc-500">
                          {friend.isOnline ? t('online') : `@${friend.username}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveFriend(friend.friendshipId)}
                        className="p-2 rounded-lg text-zinc-600 opacity-0 group-hover/friend:opacity-100 hover:bg-red-500/20 hover:text-red-400 transition-all"
                        title={t('removeFriend')}
                      >
                        <UserMinus size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );

  // ======= ABOUT VIEW =======
  const renderAbout = () => (
    <motion.div key="about" className="flex flex-col h-full" initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="h-14 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <button onClick={() => changeView('main')} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h3 className="text-sm font-semibold text-white flex-1">{t('aboutApp')}</h3>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-4 ring-2 ring-white/10 shadow-lg shadow-blue-500/30">
          <span className="text-3xl font-bold text-white">S</span>
        </div>
        <h2 className="text-xl font-bold gradient-text mb-1">SAVA Messenger</h2>
        <p className="text-sm text-zinc-400 mb-6">{t('version')} 1.0.0</p>
        <div className="text-xs text-zinc-500 space-y-1">
          <p>{t('modernMessenger')}</p>
          <p>{t('onPrivacy')}</p>
          <p className="mt-4 text-zinc-600">© 2026 SAVA Team</p>
        </div>
      </div>
    </motion.div>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
          <motion.div
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-3 top-3 bottom-3 w-[340px] max-w-[calc(100vw-24px)] bg-surface-secondary/95 backdrop-blur-3xl shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-border/50 rounded-3xl z-50 flex flex-col overflow-hidden"
          >
            <AnimatePresence mode="wait" custom={slideDir}>
              {view === 'main' && renderMain()}
              {view === 'profile' && renderProfile()}
              {view === 'settings' && renderSettings()}
              {view === 'themes' && renderThemes()}
              {view === 'friends' && renderFriends()}
              {view === 'about' && renderAbout()}
              {view === 'sessions' && renderSessions()}
              {view === 'blocked' && renderBlocked()}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
