import { useCallback, useEffect, useState } from 'react';
import { getRepository } from '../storage';

export type ThemeSetting = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function resolve(setting: ThemeSetting): 'light' | 'dark' {
  if (setting !== 'system') return setting;
  return darkQuery().matches ? 'dark' : 'light';
}

function apply(setting: ThemeSetting) {
  document.documentElement.dataset.theme = resolve(setting);
}

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Theme preference: follows `prefers-color-scheme` by default, explicit
 * light/dark otherwise. Persisted in the settings store; applied via
 * `data-theme` on <html> (see the [data-theme] block in index.css).
 */
export function useTheme() {
  const [setting, setSettingState] = useState<ThemeSetting>('system');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await getRepository().then((r) =>
          r.getSetting<unknown>(THEME_KEY)
        );
        if (cancelled) return;
        const initial = isThemeSetting(stored) ? stored : 'system';
        setSettingState(initial);
        apply(initial);
      } catch (err) {
        console.error('localnotes: failed to load theme setting', err);
        apply('system');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (setting !== 'system') return;
    const mq = darkQuery();
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setting]);

  const setTheme = useCallback((next: ThemeSetting) => {
    setSettingState(next);
    apply(next);
    getRepository()
      .then((r) => r.putSetting(THEME_KEY, next))
      .catch((err) => console.error('localnotes: failed to save theme', err));
  }, []);

  return { setting, setTheme };
}
