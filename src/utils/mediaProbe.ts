// Browser-only link probes for the Feed check. Not unit-tested (tests run in
// node); the pool and bookkeeping around them live in linkCheck.ts, which is.
//
// They load through <audio>/<video>/<img> rather than fetch() because media
// elements aren't subject to CORS — the same reason getAudioDuration and
// detectImageMetadata use them. Unlike those helpers, a probe has to tell
// "broken" from "slow", so error and timeout resolve differently here.
import type { LinkProbe, LinkResult, LinkTarget } from './linkCheck';

const MEDIA_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 10000;

function settleOnce(signal: AbortSignal, timeoutMs: number, start: (done: (result: LinkResult) => void) => () => void): Promise<LinkResult> {
  return new Promise(resolve => {
    let settled = false;
    let cleanup: () => void = () => {};
    const done = (result: LinkResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      cleanup();
      resolve(result);
    };
    const onAbort = () => done({ status: 'unknown', reason: 'timeout' });
    const timer = setTimeout(() => done({ status: 'unknown', reason: 'timeout' }), timeoutMs);
    if (signal.aborted) {
      done({ status: 'unknown', reason: 'timeout' });
      return;
    }
    signal.addEventListener('abort', onAbort);
    cleanup = start(done);
  });
}

/** Load just the metadata of an audio or video file. */
export function probeMedia(url: string, kind: 'audio' | 'video', signal: AbortSignal, mimeType?: string): Promise<LinkResult> {
  const element = document.createElement(kind);
  // A type this browser can't decode would fail as if the file were missing,
  // while podcast apps may play it fine.
  if (mimeType && !element.canPlayType(mimeType)) {
    return Promise.resolve({ status: 'unknown', reason: 'format' });
  }
  return settleOnce(signal, MEDIA_TIMEOUT_MS, done => {
    element.preload = 'metadata';
    element.muted = true;
    element.onloadedmetadata = () => {
      const duration = element.duration;
      done(Number.isFinite(duration) && duration > 0 ? { status: 'ok', durationSeconds: duration } : { status: 'ok' });
    };
    element.onerror = () => done({ status: 'broken' });
    element.src = url;
    return () => {
      element.onloadedmetadata = null;
      element.onerror = null;
      // Not `src = ''`: an empty src resolves to the page's own URL and fires
      // another request. Removing the attribute and reloading stops the download.
      element.removeAttribute('src');
      element.load();
    };
  });
}

/** Load an image and report its natural size. */
export function probeImage(url: string, signal: AbortSignal): Promise<LinkResult> {
  return settleOnce(signal, IMAGE_TIMEOUT_MS, done => {
    const image = new Image();
    // Podcast apps send no Referer; hotlink protection that keys on ours would
    // otherwise report a working image as broken.
    image.referrerPolicy = 'no-referrer';
    image.onload = () => done({ status: 'ok', width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
    image.onerror = () => done({ status: 'broken' });
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    };
  });
}

/** The probe the Feed check runs for each link. */
export const probeLink: LinkProbe = (target: LinkTarget, signal: AbortSignal) => {
  // On the https app an http:// URL is mixed content: the browser upgrades or
  // blocks it, so the outcome says nothing about podcast apps. The url-http rule
  // reports these instead. (Local dev on http://localhost still probes them.)
  if (window.location.protocol === 'https:' && /^http:\/\//i.test(target.url)) {
    return Promise.resolve({ status: 'unknown', reason: 'http' });
  }
  return target.kind === 'image'
    ? probeImage(target.url, signal)
    : probeMedia(target.url, target.kind, signal, target.mimeType);
};
