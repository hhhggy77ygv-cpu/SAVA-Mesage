// ─── User types ────────────────────────────────────────────────────────

export interface UserBasic {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

export interface UserPresence extends UserBasic {
  isOnline: boolean;
  lastSeen: string;
}

export interface User extends UserPresence {
  bio: string | null;
  birthday: string | null;
  e2eePublicKey: string | null;
  createdAt: string;
  hideStoryViews?: boolean;
  statusEmoji?: string | null;
  statusText?: string | null;
  dndEnabled?: boolean;
  dndFrom?: string | null;
  dndTo?: string | null;
  blockedUserIds?: string;
}

// ─── Chat types ────────────────────────────────────────────────────────

export interface ChatMember {
  id: string;
  userId: string;
  role: string;
  isPinned?: boolean;
  isMuted?: boolean;
  isArchived?: boolean;
  clearedAt?: string | null;
  user: UserPresence;
}

export interface MediaItem {
  id: string;
  type: string;
  url: string;
  filename: string | null;
  thumbnail: string | null;
  size: number | null;
  duration: number | null;
  width?: number | null;
  height?: number | null;
}

export interface Reaction {
  id: string;
  emoji: string;
  userId: string;
  user: { id: string; username: string; displayName: string };
}

export interface MessageSender {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string | null;
  type: string;
  replyToId: string | null;
  quote?: string | null;
  forwardedFromId?: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  scheduledAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  e2ee?: boolean;
  sender: MessageSender & { e2eePublicKey?: string | null };
  replyTo?: {
    id: string;
    content: string | null;
    quote?: string | null;
    sender: { id: string; username: string; displayName: string };
  } | null;
  forwardedFrom?: UserBasic | null;
  media: MediaItem[];
  reactions: Reaction[];
  readBy: Array<{ userId: string }>;
}

export interface Chat {
  id: string;
  type: string;
  name: string | null;
  avatar: string | null;
  createdAt: string;
  members: ChatMember[];
  messages: Message[];
  unreadCount: number;
  pinnedMessages?: Array<{
    id: string;
    message: Message;
  }>;
}

// ─── Socket event types ────────────────────────────────────────────────

export interface TypingUser {
  chatId: string;
  userId: string;
}

export interface CallInfo {
  from: string;
  offer: RTCSessionDescriptionInit;
  callType: 'voice' | 'video';
  chatId: string;
  callerInfo?: UserBasic | null;
}

// ─── Story types ───────────────────────────────────────────────────────

export interface Story {
  id: string;
  type: string;
  mediaUrl: string | null;
  content: string | null;
  bgColor: string | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  viewed: boolean;
}

export interface StoryViewer {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  viewedAt: string;
}

export interface StoryGroup {
  user: UserBasic;
  stories: Story[];
  hasUnviewed: boolean;
}

// ─── Utility types ─────────────────────────────────────────────────

// ─── Friend types ──────────────────────────────────────────────────

export interface FriendRequest {
  id: string;
  user: User;
  createdAt: string;
}

export interface FriendWithId extends UserPresence {
  friendshipId: string;
}

export interface FriendshipStatus {
  status: 'none' | 'pending' | 'accepted' | 'declined' | 'self';
  friendshipId?: string | null;
  direction?: 'incoming' | 'outgoing';
}

// ─── Utility types ─────────────────────────────────────────────────────

/** Audio file extensions recognized by the app. */
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'] as const;

/** Max file size for uploads (50MB). */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Max avatar size (5MB). */
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

// ─── Poll types ────────────────────────────────────────────────────────

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Poll {
  id: string;
  question: string;
  multipleChoice: boolean;
  options: PollOption[];
  totalVotes: number;
  myVotes: string[];
}

// ─── Session types ─────────────────────────────────────────────────────

export interface Session {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
}
