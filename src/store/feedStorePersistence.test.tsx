import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { FeedProvider, useFeed } from './feedStore';
import type { FeedAction } from './feedStore';

const { albumSave, videoSave, publisherSave } = vi.hoisted(() => ({
  albumSave: vi.fn(),
  videoSave: vi.fn(),
  publisherSave: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  albumStorage: { load: () => null, save: albumSave },
  videoStorage: { load: () => null, save: videoSave },
  publisherStorage: { load: () => null, save: publisherSave },
  feedTypeStorage: { load: () => 'album' as const, save: vi.fn() },
}));

vi.mock('../utils/desktopStorage', () => ({
  saveToDesktop: vi.fn(),
  loadFromDesktop: vi.fn(),
  DESKTOP_KEYS: {},
}));

vi.mock('../utils/api', () => ({
  isTauri: () => false,
  apiFetch: vi.fn(),
}));

vi.mock('../utils/hostedFeed', () => ({
  hydrateHostedCredentials: vi.fn(),
}));

vi.mock('../utils/nostr', () => ({
  hydrateNostrUser: vi.fn(),
}));

function DispatchGrabber({ onReady }: { onReady: (d: React.Dispatch<FeedAction>) => void }) {
  const { dispatch } = useFeed();
  useEffect(() => {
    onReady(dispatch);
  }, [onReady, dispatch]);
  return null;
}

let dispatchRef: React.Dispatch<FeedAction>;

function renderProvider() {
  return render(
    <FeedProvider>
      <DispatchGrabber onReady={(d) => { dispatchRef = d; }} />
    </FeedProvider>
  );
}

describe('FeedProvider persistence debouncing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not save to localStorage on every change, only after the debounce window', () => {
    renderProvider();
    // Flush the save scheduled by the initial mount effect
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    albumSave.mockClear();

    act(() => {
      dispatchRef({ type: 'UPDATE_ALBUM', payload: { title: 'T' } });
    });
    expect(albumSave).not.toHaveBeenCalled();

    act(() => {
      dispatchRef({ type: 'UPDATE_ALBUM', payload: { title: 'Ti' } });
    });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(albumSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(albumSave).toHaveBeenCalledTimes(1);
    expect(albumSave.mock.calls[0][0].title).toBe('Ti');
  });

  it('flushes pending edits synchronously on pagehide', () => {
    renderProvider();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    albumSave.mockClear();

    act(() => {
      dispatchRef({ type: 'UPDATE_ALBUM', payload: { title: 'Unsaved edit' } });
    });
    expect(albumSave).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(albumSave).toHaveBeenCalled();
    const lastCall = albumSave.mock.calls[albumSave.mock.calls.length - 1];
    expect(lastCall[0].title).toBe('Unsaved edit');
  });

  it('flushes pending edits synchronously on beforeunload', () => {
    renderProvider();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    albumSave.mockClear();

    act(() => {
      dispatchRef({ type: 'UPDATE_ALBUM', payload: { title: 'Another edit' } });
    });
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(albumSave).toHaveBeenCalled();
  });
});
