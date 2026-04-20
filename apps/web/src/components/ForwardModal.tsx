import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Send, MessageSquare } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useLang } from '../lib/i18n';
import Avatar from './Avatar';

interface ForwardModalProps {
  onClose: () => void;
  onForward: (chatId: string, comment?: string) => void;
  excludeChatId?: string;
}

export default function ForwardModal({ onClose, onForward, excludeChatId }: ForwardModalProps) {
  const { chats } = useChatStore();
  const { user } = useAuthStore();
  const { t } = useLang();
  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const filteredChats = chats.filter((chat) => {
    if (excludeChatId && chat.id === excludeChatId) return false;
    const otherMember = chat.members.find((m) => m.userId !== user?.id);
    const chatName = chat.type === 'personal'
      ? otherMember?.user.displayName || otherMember?.user.username || t('chat')
      : chat.name || t('group');
    return chatName.toLowerCase().includes(search.toLowerCase());
  });

  // Single click — forward immediately without comment
  const handleSelectChat = (chatId: string) => {
    onForward(chatId);
    onClose();
  };

  // Send with comment
  const handleSendWithComment = () => {
    if (!pendingChatId) return;
    onForward(pendingChatId, comment.trim() || undefined);
    onClose();
  };

  const pendingChat = pendingChatId ? chats.find(c => c.id === pendingChatId) : null;
  const pendingChatName = pendingChat
    ? pendingChat.type === 'personal'
      ? pendingChat.members.find(m => m.userId !== user?.id)?.user.displayName
        || pendingChat.members.find(m => m.userId !== user?.id)?.user.username
        || t('chat')
      : pendingChat.name || t('group')
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md bg-surface-secondary/90 glass-strong rounded-3xl overflow-hidden shadow-2xl border border-border"
      >
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-white/5">
          <h2 className="text-lg font-semibold text-white">{t('forwardMessage')}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <X size={20} className="text-zinc-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text"
              placeholder={t('searchChats') || 'Поиск чатов'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Chat list */}
          <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
            {filteredChats.map((chat) => {
              const otherMember = chat.members.find((m) => m.userId !== user?.id);
              const chatName = chat.type === 'personal'
                ? otherMember?.user.displayName || otherMember?.user.username || t('chat')
                : chat.name || t('group');
              const chatAvatar = chat.type === 'personal' ? otherMember?.user.avatar : chat.avatar;

              return (
                <div key={chat.id} className="flex items-center gap-1">
                  {/* Main button — forward immediately */}
                  <button
                    onClick={() => handleSelectChat(chat.id)}
                    className="flex-1 flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors text-left"
                  >
                    <Avatar src={chatAvatar} name={chatName} size="md" />
                    <span className="text-white font-medium flex-1 truncate">{chatName}</span>
                  </button>
                  {/* Comment button — open comment field */}
                  <button
                    onClick={() => {
                      setPendingChatId(chat.id);
                      setAddingComment(true);
                      setTimeout(() => commentInputRef.current?.focus(), 100);
                    }}
                    title="Переслать с комментарием"
                    className="p-2 rounded-xl text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors flex-shrink-0"
                  >
                    <MessageSquare size={16} />
                  </button>
                </div>
              );
            })}
            {filteredChats.length === 0 && (
              <p className="text-center text-zinc-500 py-4 text-sm">{t('nothingFound')}</p>
            )}
          </div>

          {/* Comment field */}
          <AnimatePresence>
            {addingComment && pendingChatId && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-1 space-y-2 border-t border-white/5">
                  <div className="flex items-center gap-2 px-1 pt-2">
                    <div className="w-1 h-8 rounded-full bg-accent/60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-zinc-500">{t('forward')} →</p>
                      <p className="text-sm font-medium text-white truncate">{pendingChatName}</p>
                    </div>
                    <button
                      onClick={() => { setAddingComment(false); setPendingChatId(null); setComment(''); }}
                      className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      ref={commentInputRef}
                      type="text"
                      placeholder="Добавить комментарий..."
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendWithComment(); }}
                      maxLength={500}
                      className="flex-1 bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white placeholder-zinc-500 focus:outline-none focus:border-accent transition-colors text-sm"
                    />
                    <button
                      onClick={handleSendWithComment}
                      className="w-10 h-10 rounded-xl bg-accent hover:bg-accent-hover flex items-center justify-center flex-shrink-0 transition-colors shadow-md"
                    >
                      <Send size={16} className="text-white translate-x-[1px]" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="text-[11px] text-zinc-600 text-center">
            Нажмите на чат для пересылки · <MessageSquare size={10} className="inline" /> для добавления комментария
          </p>
        </div>
      </motion.div>
    </div>
  );
}
