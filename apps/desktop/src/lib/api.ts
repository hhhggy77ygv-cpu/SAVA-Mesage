import type { User, UserBasic, UserPresence, Chat, Message, MediaItem, StoryGroup, FriendRequest, FriendWithId, FriendshipStatus } from './types';
import { isElectron } from './electron';

// В Electron используем прямой URL к серверу
const getApiBase = () => {
  if (isElectron()) {
    const isHttps = import.meta.env.VITE_DEV_SERVER_URL?.startsWith('https');
    // Можно настроить через переменные окружения или конфиг
    return import.meta.env.VITE_API_URL || (isHttps ? 'https://localhost:3001/api' : 'http://localhost:3001/api');
  }
  return '/api';
};

const API_BASE = getApiBase();

class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = localStorage.getItem('sava_refresh_token');
  private refreshPromise: Promise<void> | null = null;

  setToken(token: string | null) { this.token = token; }
  setRefreshToken(token: string | null) {
    this.refreshToken = token;
    if (token) localStorage.setItem('sava_refresh_token', token);
    else localStorage.removeItem('sava_refresh_token');
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    if (this.refreshPromise) { await this.refreshPromise; return !!this.token; }
    let success = false;
    this.refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
        if (res.ok) {
          const { token } = await res.json();
          this.token = token;
          localStorage.setItem('sava_token', token);
          success = true;
        } else {
          this.token = null;
          this.refreshToken = null;
          localStorage.removeItem('sava_token');
          localStorage.removeItem('sava_refresh_token');
          const { useAuthStore } = await import('../stores/authStore');
          useAuthStore.getState().logout();
        }
      } catch {
        this.token = null;
        this.refreshToken = null;
        localStorage.removeItem('sava_token');
        localStorage.removeItem('sava_refresh_token');
        const { useAuthStore } = await import('../stores/authStore');
        useAuthStore.getState().logout();
      } finally {
        this.refreshPromise = null;
      }
    })();
    await this.refreshPromise;
    return success;
  }

  private async request<T>(endpoint: string, options: RequestInit & { timeout?: number } = {}): Promise<T> {
    const { timeout = 30_000, ...fetchOptions } = options;

    const doFetch = async (): Promise<Response> => {
      const controller = new AbortController();
      const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...fetchOptions.headers,
      };
      try {
        const apiBase = getApiBase();
        const url = `${apiBase}${endpoint}`;
        const r = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
        clearTimeout(timer);
        return r;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Время ожидания запроса истекло');
        throw err;
      }
    };

    let response = await doFetch();

    // Auto-refresh on 401
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
      if (response.status === 401) {
        const { useAuthStore } = await import('../stores/authStore');
        if (useAuthStore.getState().token) {
          console.warn('[API] Token expired or invalid, logging out');
          useAuthStore.getState().logout();
        }
        throw new Error('Сессия истекла. Пожалуйста, войдите снова.');
      }
      throw new Error(error.error || 'Ошибка запроса');
    }

    return response.json();
  }

  async login(username: string, password: string) {
    const result = await this.request<{ token: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setRefreshToken(result.refreshToken);
    return result;
  }

  async register(username: string, displayName: string, password: string, bio?: string, registrationPassword?: string) {
    const body: Record<string, unknown> = { username, displayName, password };
    if (bio) body.bio = bio;
    if (registrationPassword) body.registrationPassword = registrationPassword;
    const result = await this.request<{ token: string; refreshToken: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    this.setRefreshToken(result.refreshToken);
    return result;
  }

  async getRegistrationSettings() {
    return this.request<{ requireRegistrationPassword: boolean }>('/auth/registration-settings');
  }

  async logoutServer() {
    if (this.refreshToken) {
      await this.request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: this.refreshToken }) }).catch(() => {});
      this.setRefreshToken(null);
    }
  }

  async getMe() {
    return this.request<{ user: User }>('/auth/me');
  }

  // \u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438
  async searchUsers(query: string) {
    return this.request<UserPresence[]>(`/users/search?q=${encodeURIComponent(query)}`);
  }

  async getUser(id: string) {
    return this.request<User>(`/users/${id}`);
  }

  async updateProfile(data: { displayName?: string; bio?: string; birthday?: string }) {
    return this.request<User>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const apiBase = getApiBase();
    const url = apiBase.startsWith('http') ? `${apiBase}/users/avatar` : `${apiBase}/users/avatar`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error('Ошибка загрузки аватара');
    return response.json() as Promise<User>;
  }

  async removeAvatar() {
    return this.request<User>('/users/avatar', { method: 'DELETE' });
  }

  async searchMessages(query: string, chatId?: string) {
    const params = new URLSearchParams({ q: query });
    if (chatId) params.append('chatId', chatId);
    return this.request<Message[]>(`/users/messages/search?${params}`);
  }

  // \u0427\u0430\u0442\u044b
  async getChats() {
    return this.request<Chat[]>('/chats');
  }

  async createPersonalChat(userId: string) {
    return this.request<Chat>('/chats/personal', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  async createGroupChat(name: string, memberIds: string[]) {
    return this.request<Chat>('/chats/group', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    });
  }

  // \u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f
  async getMessages(chatId: string, cursor?: string) {
    const params = cursor ? `?cursor=${cursor}` : '';
    return this.request<Message[]>(`/messages/chat/${chatId}${params}`);
  }

  async uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    // Для загрузки файлов используем прямое подключение к серверу
    // Cloudflare Tunnel не поддерживает multipart/form-data корректно
    const uploadBase = isElectron() 
      ? 'http://localhost:3001/api'  // Прямое подключение для десктопа
      : API_BASE;  // Через туннель для веба

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const response = await fetch(`${uploadBase}/messages/upload`, {
      method: 'POST',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0444\u0430\u0439\u043b\u0430');
    return response.json() as Promise<{ url: string; filename: string; size: number }>;
  }

  // \u0413\u0440\u0443\u043f\u043f\u044b
  async updateGroup(chatId: string, data: { name?: string }) {
    return this.request<Chat>(`/chats/${chatId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadGroupAvatar(chatId: string, file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const apiBase = getApiBase();
    const url = apiBase.startsWith('http') ? `${apiBase}/chats/${chatId}/avatar` : `${apiBase}/chats/${chatId}/avatar`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0430\u0432\u0430\u0442\u0430\u0440\u0430');
    return response.json() as Promise<Chat>;
  }

  async removeGroupAvatar(chatId: string) {
    return this.request<Chat>(`/chats/${chatId}/avatar`, { method: 'DELETE' });
  }

  async addGroupMembers(chatId: string, userIds: string[]) {
    return this.request<Chat>(`/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  }

  async removeGroupMember(chatId: string, userId: string) {
    return this.request<Chat>(`/chats/${chatId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  async clearChat(chatId: string) {
    return this.request<{ message: string }>(`/chats/${chatId}/clear`, { method: 'POST' });
  }

  async deleteChat(chatId: string) {
    return this.request<{ message: string }>(`/chats/${chatId}`, { method: 'DELETE' });
  }

  async togglePinChat(chatId: string) {
    return this.request<{ isPinned: boolean }>(`/chats/${chatId}/pin`, { method: 'POST' });
  }

  async getSharedMedia(chatId: string, type: 'media' | 'files' | 'links') {
    return this.request<Message[]>(`/messages/chat/${chatId}/shared?type=${type}`);
  }

  async exportChat(chatId: string): Promise<void> {
    const token = this.token;
    const response = await fetch(`/api/messages/chat/${chatId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Ошибка экспорта');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${chatId}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ICE серверы для WebRTC
  async getIceServers() {
    return this.request<{ iceServers: RTCIceServer[] }>('/ice-servers');
  }

  // Stories
  async getStories() {
    return this.request<StoryGroup[]>('/stories');
  }

  async createStory(data: { type: string; mediaUrl?: string; content?: string; bgColor?: string }) {
    return this.request<{ id: string }>('/stories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async viewStory(storyId: string) {
    return this.request<{ message: string }>(`/stories/${storyId}/view`, { method: 'POST' });
  }

  async deleteStory(storyId: string) {
    return this.request<{ message: string }>(`/stories/${storyId}`, { method: 'DELETE' });
  }

  async getStoryViewers(storyId: string) {
    return this.request<Array<{ userId: string; username: string; displayName: string; avatar: string | null; viewedAt: string }>>(`/stories/${storyId}/viewers`);
  }

  // Favorites chat
  async getOrCreateFavorites() {
    return this.request<Chat>('/chats/favorites', { method: 'POST' });
  }

  // User settings
  async updateSettings(data: { hideStoryViews?: boolean }) {
    return this.request<User>('/users/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Friends
  async getFriends() {
    return this.request<FriendWithId[]>('/friends');
  }

  async getFriendRequests() {
    return this.request<FriendRequest[]>('/friends/requests');
  }

  async getOutgoingRequests() {
    return this.request<FriendRequest[]>('/friends/outgoing');
  }

  async getFriendshipStatus(userId: string) {
    return this.request<FriendshipStatus>(`/friends/status/${userId}`);
  }

  async sendFriendRequest(friendId: string) {
    return this.request<{ status: string }>('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    });
  }

  async acceptFriendRequest(friendshipId: string) {
    return this.request<{ id: string }>(`/friends/${friendshipId}/accept`, { method: 'POST' });
  }

  async declineFriendRequest(friendshipId: string) {
    return this.request<{ success: boolean }>(`/friends/${friendshipId}/decline`, { method: 'POST' });
  }

  async removeFriend(friendshipId: string) {
    return this.request<{ success: boolean }>(`/friends/${friendshipId}`, { method: 'DELETE' });
  }

  async getMutualFriends(userId: string) {
    return this.request<Array<{ id: string; username: string; displayName: string; avatar: string | null }>>(`/friends/mutual/${userId}`);
  }

  // ─── E2EE ─────────────────────────────────────────────────────────
  async registerE2eeKey(publicKey: string) {
    return this.request<{ ok: boolean }>('/users/e2ee-key', {
      method: 'POST',
      body: JSON.stringify({ publicKey }),
    });
  }

  async fetchE2eeKeys(userIds: string[]) {
    return this.request<Record<string, string | null>>('/users/e2ee-keys', {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  }

  // ─── Status & Block ───────────────────────────────────────────────
  async setStatus(emoji: string | null, text: string | null) {
    return this.request<import('./types').User>('/me/status', {
      method: 'PUT',
      body: JSON.stringify({ emoji, text }),
    });
  }

  async blockUser(userId: string) {
    return this.request<{ ok: boolean; blockedUserIds: string[] }>(`/me/block/${userId}`, { method: 'POST' });
  }

  async unblockUser(userId: string) {
    return this.request<{ ok: boolean; blockedUserIds: string[] }>(`/me/block/${userId}`, { method: 'DELETE' });
  }

  async getBlockedUsers() {
    return this.request<Array<{ id: string; username: string; displayName: string; avatar: string | null }>>('/me/blocked');
  }

  async setDnd(enabled: boolean, from?: string, to?: string) {
    return this.request<import('./types').User>('/me/dnd', {
      method: 'PUT',
      body: JSON.stringify({ enabled, from, to }),
    });
  }

  // ─── Sessions ─────────────────────────────────────────────────────
  async getSessions() {
    return this.request<import('./types').Session[]>('/me/sessions');
  }

  async terminateSession(sessionId: string) {
    return this.request<{ ok: boolean }>(`/me/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async terminateAllSessions(currentToken?: string) {
    return this.request<{ ok: boolean }>('/me/sessions', {
      method: 'DELETE',
      body: JSON.stringify({ currentToken }),
    });
  }

  // ─── Polls ────────────────────────────────────────────────────────
  async getPoll(messageId: string) {
    return this.request<import('./types').Poll>(`/polls/${messageId}`);
  }

  async votePoll(messageId: string, optionIds: string[]) {
    return this.request<{ options: Array<{ id: string; votes: number }>; totalVotes: number; myVotes: string[] }>(
      `/polls/${messageId}/vote`,
      { method: 'POST', body: JSON.stringify({ optionIds }) }
    );
  }

  async getLinkPreview(url: string) {
    return this.request<{
      url: string;
      title: string | null;
      description: string | null;
      image: string | null;
      favicon: string | null;
      siteName: string | null;
    }>(`/linkpreview?url=${encodeURIComponent(url)}`);
  }
}

export const api = new ApiClient();
