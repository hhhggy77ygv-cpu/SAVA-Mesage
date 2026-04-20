import { io, Socket } from 'socket.io-client';
import { flushQueue } from './messageQueue';
import { isElectron } from './electron';

let socket: Socket | null = null;
let isConnected = false;

export function getSocketConnectionStatus(): boolean {
  return isConnected;
}

export function connectSocket(token: string): Socket {
  if (socket?.connected) {
    return socket;
  }

  // Clean up old socket instance if it exists but is disconnected
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  const isDev = import.meta.env.DEV;
  const isDesktop = isElectron();
  const isHttps = isDev && import.meta.env.VITE_DEV_SERVER_URL?.startsWith('https');

  // В Electron используем прямой URL к серверу (может быть HTTP или HTTPS)
  const socketUrl = isDesktop
    ? (import.meta.env.VITE_API_URL?.replace('/api', '') || (isHttps ? 'https://localhost:3001' : 'http://localhost:3001'))
    : (isDev ? (isHttps ? 'https://localhost:3001' : 'http://localhost:3001') : window.location.origin);

  socket = io(socketUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('Socket подключён');
    isConnected = true;
    // Flush any messages that were queued while offline
    flushQueue((payload) => {
      socket?.emit('send_message', payload);
    });
  });

  socket.on('disconnect', () => {
    console.log('Socket отключён');
    isConnected = false;
  });

  socket.on('connect_error', (err) => {
    console.error('Ошибка подключения Socket:', err.message);
    isConnected = false;
  });

  socket.on('error', (data: { message: string }) => {
    console.error('Socket error:', data.message);
    // Show error notification to user
    if (typeof window !== 'undefined' && data.message) {
      // You can integrate with your notification system here
      console.warn('Server error:', data.message);
    }
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
