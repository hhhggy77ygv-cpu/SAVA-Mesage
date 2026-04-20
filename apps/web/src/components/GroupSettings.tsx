import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Camera,
  Edit3,
  Check,
  Loader2,
  UserPlus,
  Trash2,
  Search,
  Crown,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useLang } from '../lib/i18n';
import { Chat, UserPresence } from '../lib/types';
import ConfirmModal from './ConfirmModal';

interface GroupSettingsProps {
  chat: Chat;
  onClose: () => void;
}

export default function GroupSettings({ chat, onClose }: GroupSettingsProps) {
  const { user } = useAuthStore();
  const { updateChat } = useChatStore();
  const { t } = useLang();

  const currentMember = chat.members.find((m) => m.user.id === user?.id);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const isAdmin = currentMember?.role === 'admin';

  const [isEditingName, setIsEditingName] = useState(false);
  const [groupName, setGroupName] = useState(chat.name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserPresence[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep local state in sync with chat prop
  useEffect(() => {
    setGroupName(chat.name || '');
  }, [chat.name]);

  // Search users to add
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const results = await api.searchUsers(searchQuery);
        // Filter out users already in the group
        const memberIds = new Set(chat.members.map((m) => m.user.id));
        setSearchResults(results.filter((u) => !memberIds.has(u.id)));
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, chat.members]);

  const handleSaveName = async () => {
    if (!groupName.trim()) return;
    try {
      setIsSaving(true);
      const updatedChat = await api.updateGroup(chat.id, { name: groupName.trim() });
      updateChat(updatedChat);
      setIsEditingName(false);
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
      const updatedChat = await api.uploadGroupAvatar(chat.id, file);
      updateChat(updatedChat);
    } catch (e) {
      console.error(e);
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setAvatarUploading(true);
      const updatedChat = await api.removeGroupAvatar(chat.id);
      updateChat(updatedChat);
    } catch (e) {
      console.error(e);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleAddMember = async (userId: string) => {
    try {
      const updatedChat = await api.addGroupMembers(chat.id, [userId]);
      updateChat(updatedChat);
      setSearchQuery('');
      setSearchResults([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setRemoveTargetId(userId);
  };

  const confirmRemoveMember = async () => {
    if (!removeTargetId) return;
    try {
      const updatedChat = await api.removeGroupMember(chat.id, removeTargetId);
      updateChat(updatedChat);
    } catch (e) {
      console.error(e);
    }
    setRemoveTargetId(null);
  };

  const initials = (chat.name || 'G')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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
        initial={{ opacity: 0, x: 50, scale: 0.95 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 50, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed right-3 top-3 bottom-3 w-[380px] max-w-[calc(100%-24px)] bg-surface-secondary/90 backdrop-blur-3xl shadow-2xl shadow-black/80 border border-white/5 rounded-[2rem] z-50 flex flex-col overflow-hidden ring-1 ring-white/10"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <h2 className="text-lg font-semibold text-white">{t('groupSettings')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-surface-hover transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Avatar */}
          <div className="flex flex-col items-center py-8 px-6">
            <div className="relative group">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-vortex-500/20 rounded-full blur-[40px] pointer-events-none" />
              <div className="relative z-10 p-1.5 rounded-full bg-gradient-to-br from-white/10 to-transparent backdrop-blur-md border border-white/10 shadow-2xl">
                {chat.avatar ? (
                  <img
                    src={chat.avatar}
                    alt=""
                    className="w-32 h-32 rounded-full object-cover shadow-inner"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white font-bold text-4xl shadow-inner">
                    {initials}
                  </div>
                )}
              </div>

              {isAdmin && (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    {avatarUploading ? (
                      <Loader2 size={24} className="text-white animate-spin" />
                    ) : (
                      <Camera size={24} className="text-white" />
                    )}
                  </button>
                  {chat.avatar && (
                    <button
                      onClick={handleRemoveAvatar}
                      disabled={avatarUploading}
                      className="absolute -top-1 -right-1 w-7 h-7 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                    >
                      <X size={14} className="text-white" />
                    </button>
                  )}
                </>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>

            {/* Group name */}
            {isEditingName ? (
              <div className="mt-4 flex items-center gap-2 w-full max-w-[260px]">
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="flex-1 text-lg font-bold text-center text-white bg-transparent border-b border-vortex-500 outline-none px-2 py-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setIsEditingName(false);
                      setGroupName(chat.name || '');
                    }
                  }}
                />
                <button
                  onClick={handleSaveName}
                  disabled={isSaving || !groupName.trim()}
                  className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                </button>
                <button
                  onClick={() => {
                    setIsEditingName(false);
                    setGroupName(chat.name || '');
                  }}
                  className="p-1.5 rounded-lg text-zinc-400 hover:bg-surface-hover transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <h3 className="text-xl font-bold text-white">{chat.name}</h3>
                {isAdmin && (
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-surface-hover transition-colors"
                  >
                    <Edit3 size={14} />
                  </button>
                )}
              </div>
            )}

            <p className="text-sm text-zinc-400 mt-1 flex items-center gap-1">
              <Users size={14} />
              {chat.members.length} {t('members')}
            </p>
          </div>

          {/* Members */}
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                {t('membersCount')}
              </h4>
              {isAdmin && (
                <button
                  onClick={() => {
                    setShowAddMember(!showAddMember);
                    if (!showAddMember) {
                      setTimeout(() => searchInputRef.current?.focus(), 100);
                    }
                  }}
                  className="flex items-center gap-1 text-xs text-vortex-400 hover:text-vortex-300 transition-colors"
                >
                  <UserPlus size={14} />
                  {t('addMember')}
                </button>
              )}
            </div>

            {/* Add member search */}
            <AnimatePresence>
              {showAddMember && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-3"
                >
                  <div className="relative mb-2">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('findUser')}
                      className="w-full pl-8 pr-3 py-2 rounded-xl bg-surface-tertiary text-sm text-white placeholder-zinc-500 border border-border focus:border-accent transition-colors"
                    />
                  </div>
                  {isSearching && (
                    <div className="flex justify-center py-2">
                      <Loader2 size={16} className="text-zinc-500 animate-spin" />
                    </div>
                  )}
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleAddMember(u.id)}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-xl hover:bg-surface-hover transition-colors"
                    >
                      {u.avatar ? (
                        <img src={u.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                          {(u.displayName || u.username || '?')[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm text-white truncate">{u.displayName || u.username}</p>
                        <p className="text-xs text-zinc-500">@{u.username}</p>
                      </div>
                      <UserPlus size={14} className="text-vortex-400 flex-shrink-0" />
                    </button>
                  ))}
                  {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-2">{t('usersNotFound')}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Member list */}
            <div className="space-y-1">
              {chat.members
                .sort((a, b) => {
                  if (a.role === 'admin' && b.role !== 'admin') return -1;
                  if (b.role === 'admin' && a.role !== 'admin') return 1;
                  return 0;
                })
                .map((member) => (
                  <div
                    key={member.user.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-hover/50 transition-colors group"
                  >
                    <div className="relative flex-shrink-0">
                      {member.user.avatar ? (
                        <img src={member.user.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                          {(member.user.displayName || member.user.username || '?')[0].toUpperCase()}
                        </div>
                      )}
                      {member.user.isOnline && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-surface-secondary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">
                          {member.user.displayName || member.user.username}
                          {member.user.id === user?.id && (
                            <span className="text-zinc-500 ml-1 text-xs">({t('you') || 'вы'})</span>
                          )}
                        </p>
                        {member.role === 'admin' && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-[10px] font-medium flex-shrink-0">
                            <Crown size={10} />
                            {t('adminBadge')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">@{member.user.username}</p>
                    </div>
                    {isAdmin && member.user.id !== user?.id && member.role !== 'admin' && (
                      <button
                        onClick={() => handleRemoveMember(member.user.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                        title={t('removeMember')}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </motion.div>

      <ConfirmModal
        open={!!removeTargetId}
        message={t('confirmRemoveMember')}
        onConfirm={confirmRemoveMember}
        onCancel={() => setRemoveTargetId(null)}
      />
    </>
  );
}
