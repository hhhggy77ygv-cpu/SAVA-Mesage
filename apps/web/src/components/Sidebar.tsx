import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Menu,
  MessageSquare,
  X,
  User as UserIcon,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useLang } from '../lib/i18n';
import { api } from '../lib/api';
import { getInitials, generateAvatarColor } from '../lib/utils';
import Avatar from './Avatar';
import { StoryGroup } from '../lib/types';
import ChatListItem from './ChatListItem';
import NewChatModal from './NewChatModal';
import UserProfile from './UserProfile';
import SideMenu from './SideMenu';
import StoryViewer, { CreateStoryModal } from './StoryViewer';

const API_URL = import.meta.env.VITE_API_URL || '';

interface SidebarProps {
  mobileView?: 'chats' | 'chat';
  onMobileViewChange?: (view: 'chats' | 'chat') => void;
}

export default function Sidebar({ mobileView, onMobileViewChange }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const { chats, activeChat, searchQuery, setSearchQuery, clearStore } = useChatStore();
  const { t } = useLang();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [appSettings] = useState({ appName: 'SAVA', appDescription: 'Современный мессенджер', logoUrl: '/assets/favicon.svg' });

  // Admin panel removed — settings are static defaults

  const loadStories = () => {
    api.getStories().then(setStoryGroups).catch(console.error);
  };

  useEffect(() => {
    loadStories();
    const interval = setInterval(loadStories, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const filteredChats = chats.filter((chat) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (chat.name?.toLowerCase().includes(q)) return true;
    return chat.members.some(
      (m) =>
        m.user.id !== user?.id &&
        (m.user.username.toLowerCase().includes(q) ||
          m.user.displayName.toLowerCase().includes(q))
    );
  }).sort((a, b) => {
    // Favorites chat always on top
    if (a.type === 'favorites') return -1;
    if (b.type === 'favorites') return 1;
    return 0;
  });

  const handleLogout = () => {
    clearStore();
    logout();
  };

  return (
    <>
      <div className={`
        h-full flex flex-col bg-surface-secondary rounded-2xl md:rounded-3xl overflow-hidden border border-border/50 shadow-2xl relative z-10
        w-full md:w-[340px]
        ${mobileView === 'chat' ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Шапка */}
        <div className="h-[76px] px-4 flex items-center gap-3 border-b border-border/40 bg-surface-secondary flex-shrink-0">
          <button
            onClick={() => setShowSideMenu(true)}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-zinc-400 hover:text-white"
            title={t('menu')}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-white">{(appSettings.appName || 'SAVA').charAt(0).toUpperCase()}</span>
            </div>
            <h1 className="text-lg font-bold gradient-text truncate">{appSettings.appName || 'SAVA'}</h1>
          </div>
          <button
            onClick={() => setShowNewChat(true)}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-zinc-400 hover:text-white"
            title={t('newChat')}
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Поиск */}
        <div className="p-4 bg-surface-secondary/50">
          <div className="relative group">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder={t('searchChats')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-10 py-3 rounded-2xl bg-surface-tertiary/80 text-[15px] font-medium text-white placeholder-zinc-500 border border-border/30 hover:border-border/60 focus:border-accent transition-all outline-none shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full bg-surface-hover text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Story circles */}
        {storyGroups.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto scrollbar-hide border-b border-border/20 flex-shrink-0">
            {/* Add story circle */}
            <button
              onClick={() => setShowCreateStory(true)}
              className="flex flex-col items-center gap-1 flex-shrink-0 group"
            >
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center group-hover:border-vortex-400 transition-colors">
                <Plus size={20} className="text-zinc-400 group-hover:text-vortex-400 transition-colors" />
              </div>
              <span className="text-[10px] text-zinc-500 truncate w-14 text-center">{t('newStory')}</span>
            </button>

            {storyGroups.map((group, idx) => {
              const avatarUrl = group.user.avatar ? `${API_URL}${group.user.avatar}` : null;
              const isMine = group.user.id === user?.id;
              return (
                <button
                  key={group.user.id}
                  onClick={() => setStoryViewerIndex(idx)}
                  className="flex flex-col items-center gap-1 flex-shrink-0 group"
                >
                  <div className={`w-14 h-14 rounded-full p-[2.5px] transition-transform group-hover:scale-105 ${
                    group.hasUnviewed
                      ? 'bg-gradient-to-tr from-vortex-400 via-purple-500 to-pink-500 shadow-lg shadow-vortex-500/25'
                      : isMine
                        ? 'bg-gradient-to-tr from-zinc-500 to-zinc-600'
                        : 'bg-zinc-700'
                  }`}>
                    <div className="w-full h-full rounded-full overflow-hidden border-[2.5px] border-surface-secondary">
                      <Avatar
                        src={avatarUrl}
                        name={group.user.displayName || group.user.username}
                        size="lg"
                        className="w-full h-full"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-zinc-400 truncate w-14 text-center">
                    {isMine ? t('myStory') : (group.user.displayName || group.user.username).split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Список чатов */}
        <div className="flex-1 overflow-y-auto">
          {filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 px-6">
              <MessageSquare size={40} className="opacity-30" />
              <p className="text-sm text-center">
                {searchQuery ? t('nothingFound') : t('noChats')}
              </p>
            </div>
          ) : (
            filteredChats.map((chat) => (
              <ChatListItem key={chat.id} chat={chat} isActive={chat.id === activeChat} onMobileViewChange={onMobileViewChange} />
            ))
          )}
        </div>
      </div>

      {/* Модалки */}
      <AnimatePresence>
        {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showProfile && <UserProfile userId={user!.id} onClose={() => setShowProfile(false)} isSelf />}
      </AnimatePresence>
      <SideMenu
        isOpen={showSideMenu}
        onClose={() => setShowSideMenu(false)}
      />
      <AnimatePresence>
        {storyViewerIndex !== null && storyGroups.length > 0 && (
          <StoryViewer
            stories={storyGroups}
            initialUserIndex={storyViewerIndex}
            onClose={() => { setStoryViewerIndex(null); loadStories(); }}
            onRefresh={loadStories}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCreateStory && (
          <CreateStoryModal
            onClose={() => setShowCreateStory(false)}
            onCreated={loadStories}
          />
        )}
      </AnimatePresence>
    </>
  );
}
