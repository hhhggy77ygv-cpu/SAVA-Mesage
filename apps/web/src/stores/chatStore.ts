import { create } from 'zustand';
import { api } from '../lib/api';
import { useAuthStore } from './authStore';
import type { Chat, ChatMember, Message, TypingUser } from '../lib/types';

interface ChatState {
  chats: Chat[];
  activeChat: string | null;
  messages: Record<string, Message[]>;
  pinnedMessages: Record<string, Message>;
  typingUsers: TypingUser[];
  replyTo: Message | null;
  editingMessage: Message | null;
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  searchQuery: string;
  drafts: Record<string, string>;

  setActiveChat: (chatId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setDraft: (chatId: string, text: string) => void;
  getDraft: (chatId: string) => string;
  loadChats: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (messageId: string, chatId: string) => void;
  removeMessages: (messageIds: string[], chatId: string) => void;
  hideMessages: (messageIds: string[], chatId: string) => void;
  addReaction: (messageId: string, chatId: string, userId: string, username: string, emoji: string) => void;
  removeReaction: (messageId: string, chatId: string, userId: string, emoji: string) => void;
  markRead: (chatId: string, userId: string, messageIds: string[]) => void;
  addTypingUser: (chatId: string, userId: string) => void;
  removeTypingUser: (chatId: string, userId: string) => void;
  updateUserOnlineStatus: (userId: string, isOnline: boolean, lastSeen?: string) => void;
  updateBlockedStatus: (userId: string, blocked: boolean) => void;
  setReplyTo: (message: Message | null) => void;
  setEditingMessage: (message: Message | null) => void;
  addChat: (chat: Chat) => void;
  updateChat: (chat: Chat) => void;
  removeChat: (chatId: string) => void;
  clearMessages: (chatId: string) => void;
  setPinnedMessage: (chatId: string, message: Message) => void;
  removePinnedMessage: (chatId: string, messageId: string, newPinned: Message | null) => void;
  clearStore: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChat: null,
  messages: {},
  pinnedMessages: {},
  typingUsers: [],
  replyTo: null,
  editingMessage: null,
  isLoadingChats: false,
  isLoadingMessages: false,
  searchQuery: '',
  drafts: JSON.parse(localStorage.getItem('sava_drafts') || '{}'),

  setActiveChat: (chatId) => set((state) => ({
    activeChat: chatId,
    replyTo: null,
    editingMessage: null,
    chats: chatId
      ? state.chats.map((c) => c.id === chatId ? { ...c, unreadCount: 0 } : c)
      : state.chats,
  })),
  setSearchQuery: (query) => set({ searchQuery: query }),

  setDraft: (chatId, text) => {
    set((state) => {
      const drafts = { ...state.drafts };
      if (text.trim()) {
        drafts[chatId] = text;
      } else {
        delete drafts[chatId];
      }
      localStorage.setItem('sava_drafts', JSON.stringify(drafts));
      return { drafts };
    });
  },

  getDraft: (chatId) => {
    return get().drafts[chatId] || '';
  },

  loadChats: async () => {
    try {
      set({ isLoadingChats: true });
      const chats = await api.getChats();
      // Auto-create favorites chat if not present
      if (!chats.some((c: any) => c.type === 'favorites')) {
        try {
          const favChat = await api.getOrCreateFavorites();
          chats.unshift(favChat);
        } catch {}
      }
      // Extract pinned messages from chats
      const pinnedMessages: Record<string, Message> = {};
      for (const chat of chats) {
        if (chat.pinnedMessages && chat.pinnedMessages.length > 0) {
          pinnedMessages[chat.id] = chat.pinnedMessages[0].message;
        }
      }
      set({ chats, pinnedMessages, isLoadingChats: false });
    } catch (error) {
      console.error('Load chats error:', error);
      set({ isLoadingChats: false });
    }
  },

  loadMessages: async (chatId) => {
    try {
      set({ isLoadingMessages: true });
      const fetched = await api.getMessages(chatId);
      set((state) => {
        // Merge fetched messages with any that arrived via socket during the fetch
        const existing = state.messages[chatId] || [];
        const fetchedIds = new Set(fetched.map(m => m.id));
        const socketOnly = existing.filter(m => !fetchedIds.has(m.id));
        const merged = [...fetched, ...socketOnly].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        return {
          messages: { ...state.messages, [chatId]: merged },
          isLoadingMessages: false,
        };
      });
    } catch (error) {
      console.error('Load messages error:', error);
      set({ isLoadingMessages: false });
    }
  },

  addMessage: (message) => {
    const userId = useAuthStore.getState().user?.id;
    set((state) => {
      const chatMessages = state.messages[message.chatId] || [];
      if (chatMessages.some((m) => m.id === message.id)) return state;

      const updatedMessages = {
        ...state.messages,
        [message.chatId]: [...chatMessages, message],
      };

      const updatedChats = state.chats.map((chat) => {
        if (chat.id === message.chatId) {
          // Update sidebar preview - keep existing messages and add new one
          const existingPreview = chat.messages || [];
          const updatedPreview = [...existingPreview, message].slice(-50); // Keep last 50 messages for preview
          
          return {
            ...chat,
            messages: updatedPreview,
            unreadCount: chat.id === state.activeChat ? chat.unreadCount : chat.unreadCount + 1,
          };
        }
        return chat;
      });

      updatedChats.sort((a, b) => {
        const aPin = a.members?.find((m) => m.user?.id === userId)?.isPinned ? 1 : 0;
        const bPin = b.members?.find((m) => m.user?.id === userId)?.isPinned ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        const aTime = a.messages[0]?.createdAt || a.createdAt;
        const bTime = b.messages[0]?.createdAt || b.createdAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      return { messages: updatedMessages, chats: updatedChats };
    });
  },

  updateMessage: (message) => {
    set((state) => {
      const chatMessages = state.messages[message.chatId] || [];
      return {
        messages: {
          ...state.messages,
          [message.chatId]: chatMessages.map((m) => (m.id === message.id ? message : m)),
        },
      };
    });
  },

  removeMessage: (messageId, chatId) => {
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      const updatedMessages = chatMessages.map((m) =>
        m.id === messageId ? { ...m, isDeleted: true, content: null } : m
      );

      // Find the latest non-deleted message to show in sidebar
      const latestVisible = updatedMessages
        .filter(m => !m.isDeleted)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      const updatedChats = state.chats.map((chat) => {
        if (chat.id === chatId) {
          // If the deleted message was the last message shown, replace with previous one
          const currentLast = chat.messages?.[0];
          if (currentLast?.id === messageId) {
            return {
              ...chat,
              messages: latestVisible ? [latestVisible] : [{ ...currentLast, isDeleted: true, content: null }],
            };
          }
        }
        return chat;
      });

      return {
        messages: {
          ...state.messages,
          [chatId]: updatedMessages,
        },
        chats: updatedChats,
      };
    });
  },

  removeMessages: (messageIds, chatId) => {
    const idsSet = new Set(messageIds);
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      const updatedMessages = chatMessages.map((m) =>
        idsSet.has(m.id) ? { ...m, isDeleted: true, content: null } : m
      );

      const latestVisible = updatedMessages
        .filter(m => !m.isDeleted)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      const updatedChats = state.chats.map((chat) => {
        if (chat.id === chatId) {
          const currentLast = chat.messages?.[0];
          if (currentLast && idsSet.has(currentLast.id)) {
            return {
              ...chat,
              messages: latestVisible ? [latestVisible] : [{ ...currentLast, isDeleted: true, content: null }],
            };
          }
        }
        return chat;
      });

      return {
        messages: { ...state.messages, [chatId]: updatedMessages },
        chats: updatedChats,
      };
    });
  },

  hideMessages: (messageIds, chatId) => {
    const idsSet = new Set(messageIds);
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      const updatedMessages = chatMessages.filter((m) => !idsSet.has(m.id));

      const latestVisible = updatedMessages
        .filter(m => !m.isDeleted)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      const updatedChats = state.chats.map((chat) => {
        if (chat.id === chatId) {
          const currentLast = chat.messages?.[0];
          if (currentLast && idsSet.has(currentLast.id)) {
            return {
              ...chat,
              messages: latestVisible ? [latestVisible] : [],
            };
          }
        }
        return chat;
      });

      return {
        messages: { ...state.messages, [chatId]: updatedMessages },
        chats: updatedChats,
      };
    });
  },

  addReaction: (messageId, chatId, userId, username, emoji) => {
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.map((m) => {
            if (m.id === messageId) {
              const exists = m.reactions.some((r) => r.userId === userId && r.emoji === emoji);
              if (exists) return m;
              return {
                ...m,
                reactions: [
                  ...m.reactions,
                  { id: `${messageId}-${userId}-${emoji}`, emoji, userId, user: { id: userId, username, displayName: username } },
                ],
              };
            }
            return m;
          }),
        },
      };
    });
  },

  removeReaction: (messageId, chatId, userId, emoji) => {
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.map((m) => {
            if (m.id === messageId) {
              return {
                ...m,
                reactions: m.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji)),
              };
            }
            return m;
          }),
        },
      };
    });
  },

  markRead: (chatId, userId, messageIds) => {
    const currentUserId = useAuthStore.getState().user?.id;
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.map((m) => {
            if (messageIds.includes(m.id)) {
              const alreadyRead = m.readBy?.some((r) => r.userId === userId);
              if (alreadyRead) return m;
              return { ...m, readBy: [...(m.readBy || []), { userId }] };
            }
            return m;
          }),
        },
        chats: state.chats.map((chat) => {
          if (chat.id === chatId && userId === currentUserId) {
            return { ...chat, unreadCount: 0 };
          }
          return chat;
        }),
      };
    });
  },

  addTypingUser: (chatId, userId) => {
    set((state) => {
      const exists = state.typingUsers.some((t) => t.chatId === chatId && t.userId === userId);
      if (exists) return state;
      return { typingUsers: [...state.typingUsers, { chatId, userId }] };
    });
  },

  removeTypingUser: (chatId, userId) => {
    set((state) => ({
      typingUsers: state.typingUsers.filter((t) => !(t.chatId === chatId && t.userId === userId)),
    }));
  },

  updateUserOnlineStatus: (userId, isOnline, lastSeen) => {
    set((state) => ({
      chats: state.chats.map((chat) => ({
        ...chat,
        members: chat.members.map((m) =>
          m.user.id === userId
            ? { ...m, user: { ...m.user, isOnline, lastSeen: lastSeen || m.user.lastSeen } }
            : m
        ),
      })),
    }));
  },

  updateBlockedStatus: (userId, blocked) => {
    // Update blockedUserIds on the member who blocked/unblocked us
    set((state) => ({
      chats: state.chats.map((chat) => ({
        ...chat,
        members: chat.members.map((m) => {
          if (m.user.id !== userId) return m;
          try {
            const current: string[] = JSON.parse((m.user as any).blockedUserIds || '[]');
            const myId = useAuthStore.getState().user?.id || '';
            let updated: string[];
            if (blocked) {
              updated = current.includes(myId) ? current : [...current, myId];
            } else {
              updated = current.filter(id => id !== myId);
            }
            return { ...m, user: { ...m.user, blockedUserIds: JSON.stringify(updated) } };
          } catch {
            return m;
          }
        }),
      })),
    }));
  },

  setReplyTo: (message) => set({ replyTo: message, editingMessage: null }),
  setEditingMessage: (message) => set({ editingMessage: message, replyTo: null }),

  addChat: (chat) => {
    set((state) => {
      if (state.chats.some((c) => c.id === chat.id)) return state;
      return { chats: [chat, ...state.chats] };
    });
  },

  updateChat: (chat) => {
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)),
    }));
  },

  removeChat: (chatId) => {
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== chatId),
      activeChat: state.activeChat === chatId ? null : state.activeChat,
      messages: (() => { const m = { ...state.messages }; delete m[chatId]; return m; })(),
    }));
  },

  clearMessages: (chatId) => {
    set((state) => ({
      messages: { ...state.messages, [chatId]: [] },
      chats: state.chats.map((c) =>
        c.id === chatId ? { ...c, messages: [] } : c
      ),
    }));
  },

  setPinnedMessage: (chatId, message) => {
    set((state) => ({
      pinnedMessages: { ...state.pinnedMessages, [chatId]: message },
    }));
  },

  removePinnedMessage: (chatId, _messageId, newPinned) => {
    set((state) => {
      const updated = { ...state.pinnedMessages };
      if (newPinned) {
        updated[chatId] = newPinned;
      } else {
        delete updated[chatId];
      }
      return { pinnedMessages: updated };
    });
  },

  clearStore: () => {
    set({
      chats: [],
      activeChat: null,
      messages: {},
      pinnedMessages: {},
      typingUsers: [],
      replyTo: null,
      editingMessage: null,
    });
  },
}));
