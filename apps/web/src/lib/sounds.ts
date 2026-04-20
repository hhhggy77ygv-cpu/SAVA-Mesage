// Notification sound using Web Audio API — generates a pleasant chime
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const now = ctx.currentTime;

    // Soft, warm notification — lower frequencies, triangle waves, gentle volume
    // First note — warm mellow tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second note — gentle higher tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(659.25, now + 0.08); // E5
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.06, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch (e) {
    // Audio context not supported — silent fail
  }
}

// Muted chats stored in localStorage
const MUTED_KEY = 'sava_muted_chats';

export function getMutedChats(): Set<string> {
  try {
    const stored = localStorage.getItem(MUTED_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

export function toggleMuteChat(chatId: string): boolean {
  const muted = getMutedChats();
  if (muted.has(chatId)) {
    muted.delete(chatId);
  } else {
    muted.add(chatId);
  }
  localStorage.setItem(MUTED_KEY, JSON.stringify([...muted]));
  return muted.has(chatId);
}

export function isChatMuted(chatId: string): boolean {
  return getMutedChats().has(chatId);
}

// Call ringtone
let callAudio: HTMLAudioElement | null = null;

export function playCallRingtone() {
  try {
    if (callAudio) {
      callAudio.pause();
      callAudio.currentTime = 0;
    }
    callAudio = new Audio('/sounds/call_sound.mp3');
    callAudio.loop = true;
    callAudio.volume = 0.5;
    callAudio.play().catch(() => {});
  } catch (e) {
    // silent fail
  }
}

export function stopCallRingtone() {
  try {
    if (callAudio) {
      callAudio.pause();
      callAudio.currentTime = 0;
      callAudio = null;
    }
  } catch (e) {
    // silent fail
  }
}

// "Абонент недоступен" sound
export function playUnavailableSound(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio('/sounds/abonent_nedostupen.mp3');
      audio.volume = 0.7;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    } catch (e) {
      resolve();
    }
  });
}
