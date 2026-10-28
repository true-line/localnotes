import { useCallback, useEffect, useState } from 'react';
import { getRepository } from '../storage';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function resolve(setting: ThemeSetting): ResolvedTheme {
  if (setting !== 'system') return setting;
  return darkQuery().matches ? 'dark' : 'light';
}

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Theme preference: follows `prefers-color-scheme` by default, explicit
 * light/dark otherwise. Persisted in the settings store; applied via
 * `data-theme` on <html> (see the [data-theme] block in index.css).
 * `resolved` is the effective appearance — UI toggles must key off it,
 * not off the setting (a `system` user on a dark OS is already dark).
 */
export function useTheme() {
  const [setting, setSettingState] = useState<ThemeSetting>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolve('system')
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await getRepository().then((r) =>
          r.getSetting<unknown>(THEME_KEY)
        );
        if (cancelled) return;
        setSettingState(isThemeSetting(stored) ? stored : 'system');
      } catch (err) {
        console.error('localnotes: failed to load theme setting', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Single applier: runs for the default, the loaded setting, and OS flips
  useEffect(() => {
    const mq = darkQuery();
    const update = () => {
      const appearance = resolve(setting);
      document.documentElement.dataset.theme = appearance;
      setResolved(appearance);
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [setting]);

  const setTheme = useCallback((next: ThemeSetting) => {
    setSettingState(next);
    getRepository()
      .then((r) => r.putSetting(THEME_KEY, next))
      .catch((err) => console.error('localnotes: failed to save theme', err));
  }, []);

  return { setting, resolved, setTheme };
}
