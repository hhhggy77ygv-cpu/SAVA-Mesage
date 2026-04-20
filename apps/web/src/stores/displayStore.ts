import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontSize = 'small' | 'medium' | 'large';

interface DisplayState {
  fontSize: FontSize;
  compactMode: boolean;
  setFontSize: (size: FontSize) => void;
  setCompactMode: (compact: boolean) => void;
}

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '13px',
  medium: '15px',
  large: '17px',
};

function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty('--chat-font-size', FONT_SIZE_MAP[size]);
}

function applyCompactMode(compact: boolean) {
  document.documentElement.classList.toggle('compact-mode', compact);
}

export const useDisplayStore = create<DisplayState>()(
  persist(
    (set) => ({
      fontSize: 'medium',
      compactMode: false,

      setFontSize: (size) => {
        applyFontSize(size);
        set({ fontSize: size });
      },

      setCompactMode: (compact) => {
        applyCompactMode(compact);
        set({ compactMode: compact });
      },
    }),
    { name: 'sava-display' }
  )
);

// Apply on load
if (typeof window !== 'undefined') {
  const stored = JSON.parse(localStorage.getItem('sava-display') || '{}');
  if (stored.state?.fontSize) applyFontSize(stored.state.fontSize);
  if (stored.state?.compactMode) applyCompactMode(stored.state.compactMode);
}
