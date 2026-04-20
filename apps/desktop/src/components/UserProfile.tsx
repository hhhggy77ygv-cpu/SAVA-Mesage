import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, AtSign, Edit3, Check, Loader2, Image as ImageIcon, FileText, Link as LinkIcon, Download, ExternalLink, Play, UserPlus, UserMinus, UserCheck, Clock, Ban } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useLang } from '../lib/i18n';
import { User, Message, FriendshipStatus } from '../lib/types';
import ImageLightbox from './ImageLightbox';
import { getSocket } from '../lib/socket';

interface UserProfileProps {
  userId: string;
  chatId?: string;
  onClose: () => void;
  isSelf?: boolean;
}

type MediaTab = 'media' | 'files' | 'links';

export default function UserProfile({ userId, chatId, onClose, isSelf }: UserProfileProps) {
  const { user: authUser, updateUser } = useAuthStore();
  const { t, lang } = useLang();
  const [profile, setProfile] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MediaTab>('media');

  // Shared media state
  const [sharedMedia, setSharedMedia] = useState<Message[]>([]);
  const [sharedFiles, setSharedFiles] = useState<Message[]>([]);
  const [sharedLinks, setSharedLinks] = useState<Array<Message & { links?: string[] }>>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<MediaTab>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Friend state
  const [friendStatus, setFriendStatus] = useState<FriendshipStatus | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);
  const [mutualFriends, setMutualFriends] = useState<Array<{ id: string; username: string; displayName: string; avatar: string | null }>>([]);
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    loadProfile();
    if (!isSelf) {
      api.getFriendshipStatus(userId).then(setFriendStatus).catch(() => {});
      api.getMutualFriends(userId).then(setMutualFriends).catch(() => {});
      // Check if blocked using local authUser data (no extra request)
      try {
        const blocked: string[] = JSON.parse(authUser?.blockedUserIds || '[]');
        setIsBlocked(blocked.includes(userId));
      } catch {
        setIsBlocked(false);
      }
    }
  }, [userId, authUser?.blockedUserIds]);

  // Load shared media/files/links when tab changes
  const loadTabData = useCallback(async (tab: MediaTab) => {
    if (!chatId || loadedTabs.has(tab)) return;
    setTabLoading(true);
    try {
      const data = await api.getSharedMedia(chatId, tab);
      if (tab === 'media') setSharedMedia(data);
      else if (tab === 'files') setSharedFiles(data);
      else setSharedLinks(data);
      setLoadedTabs(prev => new Set(prev).add(tab));
    } catch (e) {
      console.error('Failed to load shared', tab, e);
    } finally {
      setTabLoading(false);
    }
  }, [chatId, loadedTabs]);

  useEffect(() => {
    loadTabData(activeTab);
  }, [activeTab, loadTabData]);

  const loadProfile = async () => {
    try {
      setIsLoading(true);
      if (isSelf && authUser) {
        setProfile(authUser);
      } else {
        const data = await api.getUser(userId);
        setProfile(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendFriendRequest = async () => {
    try {
      setFriendLoading(true);
      const result = await api.sendFriendRequest(userId);
      if (result.status === 'accepted') {
        setFriendStatus({ status: 'accepted', friendshipId: null });
      } else {
        setFriendStatus({ status: 'pending', friendshipId: null, direction: 'outgoing' });
      }
      // Notify via socket
      const socket = getSocket();
      if (socket) socket.emit('friend_request', { friendId: userId });
    } catch (e) {
      console.error(e);
    } finally {
      setFriendLoading(false);
    }
  };

  const handleAcceptFriend = async () => {
    if (!friendStatus?.friendshipId) return;
    try {
      setFriendLoading(true);
      await api.acceptFriendRequest(friendStatus.friendshipId);
      setFriendStatus({ status: 'accepted', friendshipId: friendStatus.friendshipId });
      const socket = getSocket();
      if (socket) socket.emit('friend_accepted', { friendId: userId });
    } catch (e) {
      console.error(e);
    } finally {
      setFriendLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!friendStatus?.friendshipId) return;
    try {
      setFriendLoading(true);
      await api.removeFriend(friendStatus.friendshipId);
      setFriendStatus({ status: 'none', friendshipId: null });
      const socket = getSocket();
      if (socket) socket.emit('friend_removed', { friendId: userId });
    } catch (e) {
      console.error(e);
    } finally {
      setFriendLoading(false);
    }
  };

  const initials = (profile?.displayName || profile?.username || '??')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const tabs: { key: MediaTab; label: string; icon: React.ElementType }[] = [
    { key: 'media', label: t('mediaTab'), icon: ImageIcon },
    { key: 'files', label: t('filesTab'), icon: FileText },
    { key: 'links', label: t('linksTab'), icon: LinkIcon },
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, x: 50, filter: 'blur(20px)' }}
        animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, x: 50, filter: 'blur(20px)' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.8 }}
        className="fixed right-3 top-3 bottom-3 w-[360px] max-w-[calc(100%-24px)] bg-surface-secondary/80 backdrop-blur-2xl shadow-[0_0_120px_rgba(0,0,0,0.6)] border border-white/5 rounded-[2rem] z-50 flex flex-col overflow-hidden"
      >
        {/* Шапка */}
        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-blue-600/10 pointer-events-none" />
          <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-sm relative z-10">
            {isSelf ? t('myProfile') : t('profileTitle')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-black/20 text-zinc-400 hover:text-white hover:bg-white/10 transition-all border border-white/5 relative z-10"
          >
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profile ? (
          <div className="flex-1 overflow-y-auto">
            {/* Аватар */}
            <div className="flex flex-col items-center pt-8 pb-4 px-6 relative overflow-visible">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] h-[240px] bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

              <div className="relative group">
                {/* Spinning gradient glow ring */}
                <div className="absolute -inset-1 bg-gradient-to-r from-accent via-blue-600 to-accent rounded-full opacity-50 blur group-hover:opacity-75 transition duration-500 animate-[spin_4s_linear_infinite]" />

                <div className="relative">
                  {profile.avatar ? (
                    <img
                      src={profile.avatar}
                      alt=""
                      className="w-32 h-32 rounded-full object-cover ring-4 ring-surface bg-surface"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-full bg-gradient-to-br from-surface to-surface-secondary flex items-center justify-center text-white font-bold text-4xl ring-4 ring-surface relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-tr from-accent/20 to-blue-600/20" />
                      <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-400 drop-shadow-md">{initials}</span>
                    </div>
                  )}
                </div>

                {profile.isOnline && (
                  <div className="absolute bottom-3 right-3 flex items-center justify-center">
                    <div className="absolute w-7 h-7 bg-emerald-500 rounded-full animate-ping opacity-60" />
                    <div className="w-7 h-7 bg-emerald-500 rounded-full border-[5px] border-surface-secondary shadow-[0_0_15px_rgba(16,185,129,0.8)]" />
                  </div>
                )}

              </div>

              {/* Имя */}
              <h3 className="mt-5 text-[28px] font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 tracking-tight text-center px-4">
                {profile.displayName || profile.username}
              </h3>

              {/* Username (неизменяемый) */}
              <div className="flex items-center gap-1.5 mt-2.5 bg-blue-500/10 hover:bg-blue-500/20 transition-colors px-4 py-1.5 rounded-full border border-blue-500/20 backdrop-blur-sm cursor-default">
                <AtSign size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-blue-100">{profile.username}</span>
              </div>

              {/* Онлайн статус */}
              <p className="text-xs font-semibold uppercase tracking-widest mt-4">
                {profile.isOnline ? (
                  <span className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    {t('online')}
                  </span>
                ) : (
                  <span className="text-zinc-500 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                    {t('wasRecently')}
                  </span>
                )}
              </p>

              {/* Custom status */}
              {(profile.statusEmoji || profile.statusText) && (
                <div className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                  {profile.statusEmoji && <span className="text-sm">{profile.statusEmoji}</span>}
                  {profile.statusText && <span className="text-xs text-zinc-300">{profile.statusText}</span>}
                </div>
              )}

              {/* Mutual friends */}
              {!isSelf && mutualFriends.length > 0 && (
                <div className="flex items-center gap-1.5 mt-3">
                  <div className="flex -space-x-2">
                    {mutualFriends.slice(0, 3).map(f => (
                      f.avatar
                        ? <img key={f.id} src={f.avatar} alt={f.displayName} className="w-6 h-6 rounded-full object-cover ring-2 ring-surface-secondary" />
                        : <div key={f.id} className="w-6 h-6 rounded-full bg-zinc-600 ring-2 ring-surface-secondary flex items-center justify-center text-[10px] text-white font-bold">{(f.displayName || f.username)[0].toUpperCase()}</div>
                    ))}
                  </div>
                  <span className="text-xs text-zinc-400">{mutualFriends.length} общих {mutualFriends.length === 1 ? 'друг' : 'друга'}</span>
                </div>
              )}

              {/* Friend button (for other users only) */}
              {!isSelf && friendStatus && (
                <div className="mt-4 flex flex-col items-center gap-2">
                  {friendStatus.status === 'none' && (
                    <button onClick={handleSendFriendRequest} disabled={friendLoading}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-all text-sm font-medium">
                      {friendLoading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                      {t('addFriend')}
                    </button>
                  )}
                  {friendStatus.status === 'pending' && friendStatus.direction === 'outgoing' && (
                    <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm font-medium">
                      <Clock size={16} />{t('requestSent')}
                    </div>
                  )}
                  {friendStatus.status === 'pending' && friendStatus.direction === 'incoming' && (
                    <div className="flex gap-2">
                      <button onClick={handleAcceptFriend} disabled={friendLoading}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 transition-all text-sm font-medium">
                        {friendLoading ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}{t('accept')}
                      </button>
                      <button onClick={handleRemoveFriend} disabled={friendLoading}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all text-sm font-medium">
                        {t('decline')}
                      </button>
                    </div>
                  )}
                  {friendStatus.status === 'accepted' && (
                    <button onClick={handleRemoveFriend} disabled={friendLoading}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all text-sm font-medium">
                      {friendLoading ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}{t('removeFriend')}
                    </button>
                  )}
                  {/* Block button */}
                  <button
                    onClick={async () => {
                      try {
                        if (isBlocked) {
                          const result = await api.unblockUser(userId);
                          setIsBlocked(false);
                          // Update authStore so ChatView re-renders immediately
                          updateUser({ blockedUserIds: JSON.stringify(result.blockedUserIds) });
                          // Notify the other user via socket
                          const socket = getSocket();
                          if (socket) socket.emit('user_unblocked', { targetUserId: userId });
                        } else {
                          const result = await api.blockUser(userId);
                          setIsBlocked(true);
                          updateUser({ blockedUserIds: JSON.stringify(result.blockedUserIds) });
                          const socket = getSocket();
                          if (socket) socket.emit('user_blocked', { targetUserId: userId });
                        }
                      } catch (e) {
                        console.error('Block/unblock error:', e);
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs transition-all ${isBlocked ? 'bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20' : 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10'}`}
                  >
                    <Ban size={13} />
                    {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                </div>
              )}
            </div>

            {/* Информация */}
            <div className="px-5 space-y-3 pb-8 relative z-10">
              {/* О себе */}
              <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl p-4 transition-all hover:bg-black/30 hover:border-white/10 group">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                    <Edit3 size={12} className="text-blue-400" />
                  </div>
                  <label className="text-xs font-semibold text-blue-200/50 uppercase tracking-widest">
                    {t('aboutMe')}
                  </label>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed pl-1">
                  {profile.bio || (
                    <span className="text-white/30 italic">{t('notSpecified')}</span>
                  )}
                </p>
              </div>

              {/* Дата рождения */}
              {profile.birthday && (
                <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl p-4 transition-all hover:bg-black/30 hover:border-white/10 group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
                      <Calendar size={12} className="text-orange-400" />
                    </div>
                    <label className="text-xs font-semibold text-orange-200/50 uppercase tracking-widest">
                      {t('birthday')}
                    </label>
                  </div>
                  <p className="text-sm text-zinc-200 pl-1">
                    {profile.birthday ? (
                      new Date(profile.birthday).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })
                    ) : (
                      <span className="text-white/30 italic">{t('notSpecified')}</span>
                    )}
                  </p>
                </div>
              )}

              {/* Дата регистрации */}
              <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl p-4 transition-all hover:bg-black/30 hover:border-white/10 group">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <Check size={12} className="text-emerald-400" />
                  </div>
                  <label className="text-xs font-semibold text-emerald-200/50 uppercase tracking-widest">
                    {t('onVortexSince')}
                  </label>
                </div>
                <p className="text-sm text-zinc-200 pl-1">
                  {new Date(profile.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {/* Медиа / Файлы / Ссылки */}
            <div className="border-t border-white/5 bg-black/10 mt-2 backdrop-blur-md">
              <div className="flex px-2 pt-2 gap-1 overflow-x-auto no-scrollbar">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-1 text-xs font-bold transition-all rounded-t-xl min-w-[100px] ${activeTab === tab.key
                      ? 'bg-white/10 text-white shadow-[inset_0_2px_10px_rgba(255,255,255,0.05)] border-t border-x border-white/10'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                      }`}
                  >
                    <tab.icon size={14} className={activeTab === tab.key ? 'text-blue-400' : 'opacity-70'} />
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="min-h-[160px] bg-white/[0.02] border-t border-white/5 relative">
                {/* Subtle top glow for active tab content */}
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
                {tabLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-zinc-500" />
                  </div>
                ) : activeTab === 'media' ? (
                  sharedMedia.length > 0 ? (
                    <div className="grid grid-cols-3 gap-0.5 p-1">
                      {(() => {
                        const allMedia = sharedMedia.flatMap((msg) => (msg.media || []));
                        return allMedia.map((m, idx) => (
                          <div
                            key={m.id}
                            onClick={() => setLightboxIndex(idx)}
                            className="relative aspect-square bg-zinc-900 overflow-hidden group cursor-pointer"
                          >
                            {m.type === 'video' ? (
                              <>
                                <img
                                  src={m.thumbnail || m.url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                  <Play size={24} className="text-white fill-white" />
                                </div>
                              </>
                            ) : (
                              <img
                                src={m.url}
                                alt=""
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-xs text-zinc-600 italic">{t('sharedPhotos')}</p>
                    </div>
                  )
                ) : activeTab === 'files' ? (
                  sharedFiles.length > 0 ? (
                    <div className="divide-y divide-border">
                      {sharedFiles.flatMap((msg) =>
                        (msg.media || []).map((m) => (
                          <a
                            key={m.id}
                            href={m.url}
                            download={m.filename || 'file'}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors group/file"
                          >
                            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0 border border-blue-500/30 group-hover/file:scale-105 transition-transform">
                              <FileText size={18} className="text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">{m.filename || 'file'}</p>
                              <p className="text-xs text-zinc-500">
                                {m.size ? `${(m.size / 1024).toFixed(1)} KB` : ''}
                                {msg.sender ? ` · ${msg.sender.displayName || msg.sender.username}` : ''}
                              </p>
                            </div>
                            <Download size={16} className="text-zinc-500 flex-shrink-0" />
                          </a>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-xs text-zinc-600 italic">{t('sharedFiles')}</p>
                    </div>
                  )
                ) : (
                  sharedLinks.length > 0 ? (
                    <div className="divide-y divide-border">
                      {sharedLinks.map((msg) => (
                        <div key={msg.id} className="px-4 py-3 hover:bg-white/5 transition-colors">
                          <p className="text-xs text-zinc-500 mb-1.5 font-medium">
                            {msg.sender?.displayName || msg.sender?.username} · {new Date(msg.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}
                          </p>
                          {(msg.links || []).map((link: string, i: number) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors truncate"
                            >
                              <ExternalLink size={14} className="flex-shrink-0" />
                              <span className="truncate">{link}</span>
                            </a>
                          ))}
                          {msg.content && (
                            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{msg.content}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-xs text-zinc-600 italic">{t('sharedLinks')}</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            {t('profileNotFound')}
          </div>
        )}
      </motion.div>

      {/* Media lightbox gallery */}
      <AnimatePresence>
        {lightboxIndex !== null && (
          <ImageLightbox
            images={sharedMedia.flatMap((msg) => (msg.media || []).map((m) => ({ url: m.url, type: m.type })))}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
