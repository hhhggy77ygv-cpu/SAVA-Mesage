import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { getSocket, disconnectSocket } from '../lib/socket';
import { api } from '../lib/api';
import { playNotificationSound, isChatMuted } from '../lib/sounds';
import { useLang } from '../lib/i18n';
import { notifyNewMessage, notifyIncomingCall } from '../lib/notifications';
import type { Message, UserBasic, CallInfo } from '../lib/types';
import { Send, Check } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ChatView from '../components/ChatView';
import CallModal from '../components/CallModal';
import GroupCallModal from '../components/GroupCallModal';
import OfflineIndicator from '../components/OfflineIndicator';

export default function ChatPage() {
  const {
    loadChats,
    addMessage,
    updateMessage,
    removeMessage,
    removeMessages,
    hideMessages,
    addReaction,
    removeReaction,
    markRead,
    addTypingUser,
    removeTypingUser,
    updateUserOnlineStatus,
    setPinnedMessage,
    removePinnedMessage,
    clearStore,
  } = useChatStore();
  const { user } = useAuthStore();
  const initialized = useRef(false);

  // Call state
  const [callOpen, setCallOpen] = useState(false);
  const [callTarget, setCallTarget] = useState<UserBasic | null>(null);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [incomingCall, setIncomingCall] = useState<CallInfo | null>(null);
  const [callSessionId, setCallSessionId] = useState(0);
  const [deliveryNotification, setDeliveryNotification] = useState<string | null>(null);
  const deliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group call state
  const [groupCallOpen, setGroupCallOpen] = useState(false);
  const [groupCallChatId, setGroupCallChatId] = useState('');
  const [groupCallChatName, setGroupCallChatName] = useState('');
  const [groupCallType, setGroupCallType] = useState<'voice' | 'video'>('voice');
  const [groupCallSessionId, setGroupCallSessionId] = useState(0);

  // Mobile responsive: track which view to show
  const [mobileView, setMobileView] = useState<'chats' | 'chat'>('chats');

  const { t } = useLang();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    loadChats();
  }, [loadChats]);

  // ─── Document title with unread count ────────────────────────────────
  useEffect(() => {
    const { chats } = useChatStore.getState();
    const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) SAVA` : 'SAVA';
  });

  // ─── Keyboard shortcuts ───────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+K — focus search / open new chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.querySelector<HTMLInputElement>('[placeholder*="поиск" i], [placeholder*="search" i]')?.focus();
    }
    // Alt+ArrowUp / Alt+ArrowDown — switch between chats
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const { chats, activeChat, setActiveChat, loadMessages } = useChatStore.getState();
      if (chats.length === 0) return;
      const idx = chats.findIndex(c => c.id === activeChat);
      const next = e.key === 'ArrowDown'
        ? chats[(idx + 1) % chats.length]
        : chats[(idx - 1 + chats.length) % chats.length];
      if (next) { setActiveChat(next.id); loadMessages(next.id); }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Обработка закрытия вкладки — отправить disconnect
  useEffect(() => {
    const handleBeforeUnload = () => {
      const socket = getSocket();
      if (socket) {
        socket.disconnect();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Cleanup delivery timer on unmount
  useEffect(() => {
    return () => {
      if (deliveryTimerRef.current) {
        clearTimeout(deliveryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('new_message', async (message: Message) => {
      // If this chat isn't in our store yet (e.g. someone just created it and sent a message),
      // fetch chats so the new chat appears in the sidebar immediately
      const { chats } = useChatStore.getState();
      if (!chats.some(c => c.id === message.chatId)) {
        try {
          const allChats = await api.getChats();
          const newChat = allChats.find(c => c.id === message.chatId);
          if (newChat) {
            // Reset unreadCount to 0 because addMessage below will increment it by 1
            useChatStore.getState().addChat({ ...newChat, unreadCount: 0 });
          }
        } catch (e) {
          console.error('Failed to fetch new chat:', e);
        }
      }
      addMessage(message);
      
      // Play notification sound and show browser notification for messages from others
      if (message.senderId !== user?.id && !isChatMuted(message.chatId)) {
        playNotificationSound();
        
        const senderName = message.sender?.displayName || message.sender?.username || 'Неизвестный';
        // Decrypt content for notification preview
        let messageText = message.isDeleted ? '[Удалено]' : message.content || '[Медиа]';
        if (messageText.startsWith('e2ee:')) messageText = '🔒 Зашифрованное сообщение';

        // Check for @mention
        const myUsername = user?.id ? useChatStore.getState().chats
          .flatMap(c => c.members)
          .find(m => m.user.id === user.id)?.user.username : null;
        const isMentioned = myUsername && message.content?.includes(`@${myUsername}`);

        const { notifyMention } = await import('../lib/notifications');
        if (isMentioned) {
          const chatName = useChatStore.getState().chats.find(c => c.id === message.chatId)?.name || senderName;
          notifyMention(senderName, chatName, messageText, message.sender?.avatar || undefined, () => {
            useChatStore.getState().setActiveChat(message.chatId);
          });
        } else {
          notifyNewMessage(senderName, messageText, message.sender?.avatar || undefined, () => {
            useChatStore.getState().setActiveChat(message.chatId);
          });
        }
      }
    });

    socket.on('scheduled_delivered', async (message: Message & { _recipientName?: string; _deliveredAt?: string }) => {
      // If chat unknown, fetch it first
      const { chats } = useChatStore.getState();
      if (!chats.some(c => c.id === message.chatId)) {
        try {
          const allChats = await api.getChats();
          const newChat = allChats.find(c => c.id === message.chatId);
          if (newChat) useChatStore.getState().addChat(newChat);
        } catch (_) { /* ignore */ }
      }
      // A scheduled message was delivered: update it in store (remove scheduledAt)
      updateMessage({ ...message, scheduledAt: null });

      // Show delivery notification to the sender (they sent a scheduled message that was delivered)
      if (message.senderId === user?.id && message._recipientName) {
        const time = message._deliveredAt
          ? new Date(message._deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const notifText = `${useLang.getState().t('scheduledDelivered')} ${message._recipientName} ${useLang.getState().t('scheduledDeliveredAt')} ${time}`;
        setDeliveryNotification(notifText);
        if (deliveryTimerRef.current) clearTimeout(deliveryTimerRef.current);
        deliveryTimerRef.current = setTimeout(() => setDeliveryNotification(null), 5000);
      }
    });

    socket.on('message_edited', (message: Message) => {
      updateMessage(message);
    });

    socket.on('message_deleted', (data: { messageId: string; chatId: string }) => {
      removeMessage(data.messageId, data.chatId);
    });

    socket.on('messages_deleted', (data: { messageIds: string[]; chatId: string }) => {
      removeMessages(data.messageIds, data.chatId);
    });

    socket.on('messages_hidden', (data: { messageIds: string[]; chatId: string }) => {
      hideMessages(data.messageIds, data.chatId);
    });

    socket.on('reaction_added', (data: { messageId: string; chatId: string; userId: string; username: string; emoji: string }) => {
      addReaction(data.messageId, data.chatId, data.userId, data.username, data.emoji);
    });

    socket.on('reaction_removed', (data: { messageId: string; chatId: string; userId: string; emoji: string }) => {
      removeReaction(data.messageId, data.chatId, data.userId, data.emoji);
    });

    socket.on('messages_read', (data: { chatId: string; userId: string; messageIds: string[] }) => {
      markRead(data.chatId, data.userId, data.messageIds);
    });

    socket.on('user_typing', (data: { chatId: string; userId: string }) => {
      if (data.userId !== user?.id) {
        addTypingUser(data.chatId, data.userId);
        setTimeout(() => removeTypingUser(data.chatId, data.userId), 3000);
      }
    });

    socket.on('user_stopped_typing', (data: { chatId: string; userId: string }) => {
      removeTypingUser(data.chatId, data.userId);
    });

    socket.on('user_online', (data: { userId: string }) => {
      updateUserOnlineStatus(data.userId, true);
    });

    // ─── Block / Unblock events ───────────────────────────────────────
    socket.on('you_were_blocked', (data: { byUserId: string }) => {
      // Update the blocker's member data in all chats so ChatView re-renders
      useChatStore.getState().updateBlockedStatus(data.byUserId, true);
    });

    socket.on('you_were_unblocked', (data: { byUserId: string }) => {
      useChatStore.getState().updateBlockedStatus(data.byUserId, false);
    });

    socket.on('user_offline', (data: { userId: string; lastSeen?: string }) => {
      updateUserOnlineStatus(data.userId, false, data.lastSeen);
    });

    socket.on('message_pinned', (data: { chatId: string; message: Message }) => {
      setPinnedMessage(data.chatId, data.message);
    });

    socket.on('message_unpinned', (data: { chatId: string; messageId: string; newPinnedMessage: Message | null }) => {
      removePinnedMessage(data.chatId, data.messageId, data.newPinnedMessage);
    });

    socket.on('call_incoming', async (data: CallInfo) => {
      // Use callerInfo from server if available, otherwise look up from chats
      let callerInfo: UserBasic | null = data.callerInfo || null;
      if (!callerInfo) {
        const { chats } = useChatStore.getState();
        for (const chat of chats) {
          const member = chat.members.find((m) => m.user.id === data.from);
          if (member) {
            callerInfo = member.user;
            break;
          }
        }
      }
      setCallTarget(null); // Clear any previous outgoing target
      setIncomingCall({
        from: data.from,
        offer: data.offer,
        callType: data.callType,
        chatId: data.chatId,
        callerInfo,
      });
      setCallType(data.callType);
      setCallSessionId(id => id + 1);
      setCallOpen(true);
      
      // Show browser notification for incoming call
      const callerName = callerInfo?.displayName || callerInfo?.username || 'Неизвестный';
      notifyIncomingCall(
        callerName,
        callerInfo?.avatar || undefined,
        () => {
          // Click on notification - focus window (call is already open)
          window.focus();
        }
      );
    });

    // Handle call answer (when remote party accepts the call)
    socket.on('call_answered', async (data: { from: string; answer: RTCSessionDescriptionInit; callType: 'voice' | 'video'; chatId?: string }) => {
      // This will be handled by CallModal through the peer connection
      console.log('[Socket] Call answered by:', data.from);
    });

    // Handle ICE candidates from remote peer
    socket.on('ice_candidate', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      // This will be handled by CallModal through the peer connection
      console.log('[Socket] ICE candidate received from:', data.from);
    });

    return () => {
      socket.off('new_message');
      socket.off('scheduled_delivered');
      socket.off('message_edited');
      socket.off('message_deleted');
      socket.off('messages_deleted');
      socket.off('messages_hidden');
      socket.off('reaction_added');
      socket.off('reaction_removed');
      socket.off('messages_read');
      socket.off('user_typing');
      socket.off('user_stopped_typing');
      socket.off('user_online');
      socket.off('you_were_blocked');
      socket.off('you_were_unblocked');
      socket.off('user_offline');
      socket.off('message_pinned');
      socket.off('message_unpinned');
      socket.off('call_incoming');
      socket.off('call_answered');
      socket.off('ice_candidate');
    };
  }, [user?.id]);

  const handleStartCall = (targetUser: UserBasic, type: 'voice' | 'video') => {
    setCallTarget(targetUser);
    setCallType(type);
    setIncomingCall(null);
    setCallSessionId(id => id + 1);
    setCallOpen(true);
  };

  const handleStartGroupCall = (chatId: string, chatName: string, type: 'voice' | 'video') => {
    setGroupCallChatId(chatId);
    setGroupCallChatName(chatName);
    setGroupCallType(type);
    setGroupCallSessionId(id => id + 1);
    setGroupCallOpen(true);
  };

  const handleCloseCall = () => {
    setCallOpen(false);
    setCallTarget(null);
    setIncomingCall(null);
  };

  const handleCloseGroupCall = () => {
    setGroupCallOpen(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex bg-surface p-2 md:p-3 gap-2 md:gap-3 overflow-hidden"
    >
      <Sidebar 
        mobileView={mobileView} 
        onMobileViewChange={setMobileView}
      />
      <ChatView 
        onStartCall={handleStartCall} 
        onStartGroupCall={handleStartGroupCall}
        mobileView={mobileView}
        onMobileViewChange={setMobileView}
      />
      <CallModal
        key={callSessionId}
        isOpen={callOpen}
        onClose={handleCloseCall}
        targetUser={callTarget}
        callType={callType}
        incoming={incomingCall}
      />
      <GroupCallModal
        key={`gc-${groupCallSessionId}`}
        isOpen={groupCallOpen}
        onClose={handleCloseGroupCall}
        chatId={groupCallChatId}
        chatName={groupCallChatName}
        callType={groupCallType}
      />

      {/* Scheduled message delivery notification */}
      <AnimatePresence>
        {deliveryNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl bg-surface-secondary shadow-2xl border border-border flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Send size={14} className="text-emerald-400" />
            </div>
            <span className="text-sm text-zinc-200">{deliveryNotification}</span>
          </motion.div>
        )}
      </AnimatePresence>
      
      <OfflineIndicator />
    </motion.div>
  );
}
