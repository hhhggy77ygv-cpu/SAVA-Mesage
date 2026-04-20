import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, MessageSquare, Users, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useLang } from '../lib/i18n';
import type { UserPresence, FriendWithId } from '../lib/types';

interface NewChatModalProps {
  onClose: () => void;
}

type Mode = 'personal' | 'group-select' | 'group-name';

export default function NewChatModal({ onClose }: NewChatModalProps) {
  const { user } = useAuthStore();
  const { t } = useLang();
  const { addChat, setActiveChat, loadMessages } = useChatStore();
  const [mode, setMode] = useState<Mode>('personal');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserPresence[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserPresence[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [friends, setFriends] = useState<FriendWithId[]>([]);

  // Load friends on mount
  useEffect(() => {
    api.getFriends().then(setFriends).catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 3) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setIsLoading(true);
        const results = await api.searchUsers(query);
        setUsers(results.filter((u) => u.id !== user?.id));
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, user?.id]);

  const handleSelectUser = async (selectedUser: UserPresence) => {
    if (mode === 'personal') {
      try {
        const chat = await api.createPersonalChat(selectedUser.id);
        addChat(chat);
        setActiveChat(chat.id);
        loadMessages(chat.id);
        onClose();
      } catch (e: unknown) {
        console.error(e);
      }
    } else {
      // Toggle selection
      setSelectedUsers((prev) => {
        const exists = prev.find((u) => u.id === selectedUser.id);
        if (exists) return prev.filter((u) => u.id !== selectedUser.id);
        return [...prev, selectedUser];
      });
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedUsers.length === 0) return;
    setIsCreating(true);
    try {
      const chat = await api.createGroupChat(
        groupName.trim(),
        selectedUsers.map((u) => u.id)
      );
      addChat(chat);
      setActiveChat(chat.id);
      loadMessages(chat.id);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  const isSelected = (userId: string) => selectedUsers.some((u) => u.id === userId);

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
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full max-w-md rounded-2xl glass-strong shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label={t('newChat')}>
          {/* Шапка */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              {mode !== 'personal' && (
                <button
                  onClick={() => {
                    if (mode === 'group-name') setMode('group-select');
                    else {
                      setMode('personal');
                      setSelectedUsers([]);
                    }
                  }}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-surface-hover transition-colors"
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <h2 className="text-lg font-semibold text-white">
                {mode === 'personal'
                  ? t('newChatTitle')
                  : mode === 'group-select'
                    ? t('selectMembers')
                    : t('newGroup')}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-surface-hover transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {mode === 'group-name' ? (
            /* Шаг 2: Назвать группу */
            <div className="p-4 space-y-4">
              <input
                type="text"
                placeholder={t('groupNamePlaceholder')}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-tertiary text-sm text-white placeholder-zinc-500 border border-border focus:border-accent transition-colors"
                autoFocus
              />
              <div>
                <p className="text-xs text-zinc-500 mb-2">
                  {t('membersCount')} ({selectedUsers.length}):
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30"
                    >
                      {u.avatar ? (
                        <img src={u.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[9px] font-semibold">
                          {(u.displayName || u.username)?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-white">{u.displayName || u.username}</span>
                      <button
                        onClick={() => setSelectedUsers((prev) => prev.filter((p) => p.id !== u.id))}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={handleCreateGroup}
                disabled={!groupName.trim() || isCreating}
                className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCreating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Users size={16} />
                    {t('createGroup')}
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
              {/* Переключатель режима + Поиск */}
              <div className="p-4 space-y-3">
                {mode === 'personal' && (
                  <button
                    onClick={() => setMode('group-select')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-tertiary hover:bg-surface-hover transition-colors border border-border"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                      <Users size={18} className="text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-white">{t('createGroup')}</p>
                      <p className="text-xs text-zinc-500">{t('upTo200')}</p>
                    </div>
                  </button>
                )}

                {/* Выбранные (в режиме группы) */}
                {mode === 'group-select' && selectedUsers.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => setSelectedUsers((prev) => prev.filter((p) => p.id !== u.id))}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-xs text-white hover:bg-blue-500/30 transition-colors"
                      >
                        {(u.displayName || u.username)}
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                )}

                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder={
                      mode === 'personal'
                        ? t('findUser')
                        : t('addMembers')
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface-tertiary text-sm text-white placeholder-zinc-500 border border-border focus:border-accent transition-colors"
                    autoFocus
                  />
                </div>
              </div>

              {/* Результаты */}
              <div className="max-h-72 overflow-y-auto px-2 pb-4">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : query.trim().length >= 3 && users.length > 0 ? (
                  users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                        isSelected(u.id)
                          ? 'bg-blue-500/15 border border-blue-500/30'
                          : 'hover:bg-surface-hover border border-transparent'
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        {u.avatar ? (
                          <img src={u.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-semibold text-sm">
                            {(u.displayName || u.username)?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        {u.isOnline && (
                          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-surface-secondary" />
                        )}
                      </div>
                      <div className="min-w-0 text-left flex-1">
                        <p className="text-sm font-medium text-white truncate">
                          {u.displayName || u.username}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">@{u.username}</p>
                      </div>
                      {mode === 'group-select' && (
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected(u.id)
                            ? 'bg-blue-500 border-blue-500'
                            : 'border-zinc-600'
                        }`}>
                          {isSelected(u.id) && <Check size={12} className="text-white" />}
                        </div>
                      )}
                    </button>
                  ))
                ) : query.trim().length >= 3 && users.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500">
                    <p className="text-sm">{t('usersNotFound')}</p>
                  </div>
                ) : query.trim().length > 0 && query.trim().length < 3 ? (
                  <div className="text-center py-6 text-zinc-500">
                    <p className="text-sm">{t('minCharsHint')}</p>
                  </div>
                ) : friends.length > 0 ? (
                  <>
                    <p className="text-xs text-zinc-500 uppercase tracking-wider px-2 mb-2 font-semibold">{t('friends')}</p>
                    {friends.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => handleSelectUser(u)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                          isSelected(u.id)
                            ? 'bg-blue-500/15 border border-blue-500/30'
                            : 'hover:bg-surface-hover border border-transparent'
                        }`}
                      >
                        <div className="relative flex-shrink-0">
                          {u.avatar ? (
                            <img src={u.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-semibold text-sm">
                              {(u.displayName || u.username)?.[0]?.toUpperCase() || '?'}
                            </div>
                          )}
                          {u.isOnline && (
                            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-surface-secondary" />
                          )}
                        </div>
                        <div className="min-w-0 text-left flex-1">
                          <p className="text-sm font-medium text-white truncate">
                            {u.displayName || u.username}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">@{u.username}</p>
                        </div>
                        {mode === 'group-select' && (
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected(u.id)
                              ? 'bg-blue-500 border-blue-500'
                              : 'border-zinc-600'
                          }`}>
                            {isSelected(u.id) && <Check size={12} className="text-white" />}
                          </div>
                        )}
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-8 text-zinc-500">
                    <MessageSquare size={32} className="opacity-30" />
                    <p className="text-sm">{t('enterNameOrUsername')}</p>
                  </div>
                )}
              </div>

              {/* Кнопка "Далее" для группы */}
              {mode === 'group-select' && selectedUsers.length > 0 && (
                <div className="p-4 border-t border-border">
                  <button
                    onClick={() => setMode('group-name')}
                    className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {t('next')}
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}
