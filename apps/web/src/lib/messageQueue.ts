/**
 * Offline message queue — persists unsent messages in localStorage
 * and retries them automatically when the socket reconnects.
 */

const QUEUE_KEY = 'sava_msg_queue';

export interface QueuedMessage {
  id: string;          // temp client-side ID
  chatId: string;
  payload: Record<string, unknown>;
  queuedAt: number;
}

function load(): QueuedMessage[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function save(queue: QueuedMessage[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Add a message to the queue */
export function enqueue(payload: Record<string, unknown>): string {
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const queue = load();
  queue.push({ id, chatId: String(payload.chatId ?? ''), payload, queuedAt: Date.now() });
  save(queue);
  return id;
}

/** Remove a message from the queue by temp ID */
export function dequeue(id: string): void {
  save(load().filter(m => m.id !== id));
}

/** Get all queued messages */
export function getQueue(): QueuedMessage[] {
  return load();
}

/** Clear the entire queue */
export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

/** Flush the queue — emit all pending messages via socket, then clear */
export function flushQueue(emit: (payload: Record<string, unknown>) => void): void {
  const queue = load();
  if (queue.length === 0) return;
  console.log(`[Queue] Flushing ${queue.length} queued message(s)`);
  for (const item of queue) {
    try {
      emit(item.payload);
    } catch (e) {
      console.error('[Queue] Failed to flush message:', e);
    }
  }
  clearQueue();
}
