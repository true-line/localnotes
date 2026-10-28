import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTheme } from '../hooks/useTheme';
import { getRepository } from '../storage';

describe('useTheme', () => {
  it('defaults to system and applies data-theme to <html>', async () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.setting).toBe('system');
    await waitFor(() => {
      expect(['light', 'dark']).toContain(
        document.documentElement.dataset.theme
      );
    });
  });

  it('persists an explicit theme and applies it', async () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));
    expect(result.current.setting).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    const repo = await getRepository();
    await repo.flushWrites();
    expect(await repo.getSetting('theme')).toBe('dark');
  });

  it('restores a persisted theme on mount', async () => {
    const repo = await getRepository();
    await repo.putSetting('theme', 'light');

    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.setting).toBe('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
