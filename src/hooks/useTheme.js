import { useState, useEffect, useCallback } from 'react';
import { prefGet, prefSet, PREFS_EVENT } from '../services/userPrefs';

// Saved with the person's other settings (0116), so it is the same on every device.
const STORAGE_KEY = 'offerpro-theme';

function getInitialTheme() {
  const stored = prefGet(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // The saved theme arrived after sign-in, or was changed on another device.
  useEffect(() => {
    const onPrefs = (e) => { if (e.detail?.keys?.includes(STORAGE_KEY)) setThemeState(getInitialTheme()); };
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
  }, []);

  // Saved only when the person picks one, never the default on first load,
  // which would otherwise overwrite the theme saved on another device.
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      prefSet(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setTheme = useCallback((t) => {
    if (t !== 'dark' && t !== 'light') return;
    prefSet(STORAGE_KEY, t);
    setThemeState(t);
  }, []);

  return { theme, toggleTheme, setTheme, isDark: theme === 'dark' };
}
