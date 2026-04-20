import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatTheme = 'midnight' | 'ocean' | 'forest' | 'sunset' | 'classic' | 'neon' | 'aurora' | 'cyber' | 'glass' | 'void';

interface ThemeState {
  chatTheme: ChatTheme;
  /** 'system' = follow OS preference, 'dark' / 'light' = manual override */
  colorScheme: 'system' | 'dark' | 'light';
  setChatTheme: (theme: ChatTheme) => void;
  setColorScheme: (scheme: 'system' | 'dark' | 'light') => void;
  /** Resolved value — always 'dark' or 'light' */
  resolvedScheme: 'dark' | 'light';
}

function getSystemScheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      chatTheme: 'midnight',
      colorScheme: 'system',
      resolvedScheme: getSystemScheme(),

      setChatTheme: (theme) => set({ chatTheme: theme }),

      setColorScheme: (scheme) => {
        const resolved = scheme === 'system' ? getSystemScheme() : scheme;
        set({ colorScheme: scheme, resolvedScheme: resolved });
        document.documentElement.classList.toggle('dark', resolved === 'dark');
      },
    }),
    { name: 'sava-theme-storage' }
  )
);

// Listen for OS theme changes and update if set to 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const { colorScheme, setColorScheme } = useThemeStore.getState();
    if (colorScheme === 'system') {
      setColorScheme('system');
    }
  });

  // Apply on initial load
  const { colorScheme, setColorScheme } = useThemeStore.getState();
  setColorScheme(colorScheme);
}
