/**
 * Web Notifications API wrapper for SAVA Messenger
 * 
 * Notifications work even when browser is minimized!
 * Uses the native OS notification system (Windows/Mac/Linux)
 */

// Notification permission state
let permissionState: NotificationPermission = 'default';

/**
 * Request notification permission from user
 * Returns true if granted, false if denied
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('[Notifications] This browser does not support notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    permissionState = 'granted';
    return true;
  }

  if (Notification.permission === 'denied') {
    permissionState = 'denied';
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    permissionState = permission;
    return permission === 'granted';
  } catch (error) {
    console.error('[Notifications] Error requesting permission:', error);
    return false;
  }
}

/**
 * Check if notifications are enabled
 */
export function areNotificationsEnabled(): boolean {
  return 'Notification' in window && permissionState === 'granted';
}

/**
 * Send a notification
 * 
 * @param title - Notification title (e.g., sender name)
 * @param body - Notification body (e.g., message text)
 * @param icon - Icon URL (e.g., user avatar)
 * @param tag - Unique tag to group notifications
 * @param onClick - Callback when user clicks notification
 */
export function sendNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    tag?: string;
    silent?: boolean;
    onClick?: () => void;
  }
): void {
  // Check if notifications are supported and permitted
  if (!areNotificationsEnabled()) {
    return;
  }

  try {
    const notification = new Notification(title, {
      body: options?.body || '',
      icon: options?.icon || '/favicon.ico',
      tag: options?.tag || 'message',
      silent: options?.silent || false,
      requireInteraction: false,
    });

    // Focus window and call onClick handler
    notification.onclick = (event) => {
      event.preventDefault();
      
      // Focus the browser window
      window.focus();
      
      // Call custom onClick handler
      options?.onClick?.();
      
      // Close notification
      notification.close();
    };
  } catch (error) {
    console.error('[Notifications] Error sending notification:', error);
  }
}

/**
 * Send notification for new message
 */
export function notifyNewMessage(
  senderName: string,
  messageText: string,
  avatarUrl?: string,
  onClick?: () => void
): void {
  if (!areNotificationsEnabled()) {
    return;
  }

  // Don't notify if window is focused and user is looking at the chat
  if (document.hasFocus() && document.visibilityState === 'visible') {
    return;
  }

  sendNotification(
    senderName,
    {
      body: messageText,
      icon: avatarUrl,
      tag: 'new-message',
      onClick,
    }
  );
}

/**
 * Send notification for incoming call
 */
export function notifyIncomingCall(
  callerName: string,
  avatarUrl?: string,
  onClick?: () => void
): void {
  if (!areNotificationsEnabled()) {
    return;
  }

  sendNotification(
    '📞 Входящий звонок',
    {
      body: `${callerName} звонит вам`,
      icon: avatarUrl,
      tag: 'incoming-call',
      onClick,
    }
  );
}

/**
 * Send notification for mention
 */
export function notifyMention(
  mentionedBy: string,
  chatName: string,
  messageText: string,
  avatarUrl?: string,
  onClick?: () => void
): void {
  if (!areNotificationsEnabled()) {
    return;
  }

  sendNotification(
    `@ Упоминание от ${mentionedBy}`,
    {
      body: `${chatName}: ${messageText}`,
      icon: avatarUrl,
      tag: 'mention',
      onClick,
    }
  );
}

/**
 * Initialize notification permission on app start
 */
export function initNotifications(): void {
  if (!('Notification' in window)) {
    console.warn('[Notifications] Not supported');
    return;
  }

  // Request permission if not yet decided
  if (Notification.permission === 'default') {
    // Don't auto-request, wait for user interaction
    console.info('[Notifications] Permission not yet requested');
  }

  permissionState = Notification.permission;
}
