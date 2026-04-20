import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatTime(date: string | Date, lang: string = 'ru'): string {
  const d = new Date(date);
  return d.toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date: string | Date, lang: string = 'ru'): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return lang === 'ru' ? 'Сегодня' : 'Today';
  if (days === 1) return lang === 'ru' ? 'Вчера' : 'Yesterday';
  if (days < 7) {
    const weekDaysRu = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const weekDaysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return (lang === 'ru' ? weekDaysRu : weekDaysEn)[d.getDay()];
  }

  return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: days > 365 ? 'numeric' : undefined,
  });
}

export function formatLastSeen(date: string | Date, lang: string = 'ru'): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 1) return lang === 'ru' ? 'только что' : 'just now';
  if (minutes < 60) return lang === 'ru' ? `${minutes} мин. назад` : `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'ru' ? `${hours} ч. назад` : `${hours}h ago`;

  const at = lang === 'ru' ? ' в ' : ' at ';
  return formatDate(date, lang) + at + formatTime(date, lang);
}

/**
 * Strips markdown syntax (**bold**, *italic*, _italic_, ~strikethrough~, `code`)
 * and returns plain text for use in previews.
 */
export function stripMarkdown(text: string): string {
  if (!text) return text;
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1')
    .replace(/_([\s\S]*?)_/g, '$1')
    .replace(/~([\s\S]*?)~/g, '$1')
    .replace(/`([\s\S]*?)`/g, '$1');
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function generateAvatarColor(name: string): string {
  const colors = [
    'from-violet-500 to-purple-600',
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-cyan-500 to-blue-600',
    'from-fuchsia-500 to-purple-600',
    'from-lime-500 to-green-600',
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

// Waveform cache so we don't decode the same audio twice
const waveformCache = new Map<string, number[]>();

/**
 * Decodes an audio file from a URL and extracts normalized waveform peak values.
 * Returns an array of `bars` values in [0, 1].
 */
export async function extractWaveform(url: string, bars: number = 28): Promise<number[]> {
  const cached = waveformCache.get(url);
  if (cached) return cached;

  let audioCtx: AudioContext | undefined;
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();
    audioCtx = undefined;

    const channelData = audioBuffer.getChannelData(0);
    const samplesPerBar = Math.floor(channelData.length / bars);
    const peaks: number[] = [];

    for (let i = 0; i < bars; i++) {
      let peak = 0;
      const start = i * samplesPerBar;
      // Sample a subset for performance
      const step = Math.max(1, Math.floor(samplesPerBar / 200));
      for (let j = 0; j < samplesPerBar; j += step) {
        const abs = Math.abs(channelData[start + j] || 0);
        if (abs > peak) peak = abs;
      }
      peaks.push(peak);
    }

    // Normalize to [0, 1]
    const max = Math.max(...peaks, 0.01);
    const normalized = peaks.map(p => p / max);
    waveformCache.set(url, normalized);
    return normalized;
  } catch {
    // Close leaked AudioContext if any
    if (audioCtx) audioCtx.close().catch(() => {});
    // On error, return uniform bars
    return Array(bars).fill(0.5);
  }
}
