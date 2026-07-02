// Blob-backed storage for email magic-link auth.
//
// Two namespaces, both stored as public Vercel Blobs (the SDK has no private mode) but with
// UNGUESSABLE pathnames so they're effectively private:
//   accounts/links/<sha256(rawToken)>.json  — single-use magic-link records, deleted on redeem.
//       Path entropy = 256-bit random token hash. Content carries only emailHash (never raw email).
//   accounts/index/<emailHash>.json          — per-account feed list. Path = keyed HMAC (unguessable
//       without the server key); content is just feed GUIDs, which are already public.
// External callers cannot list() (needs BLOB_READ_WRITE_TOKEN) and cannot guess the store
// subdomain + high-entropy path, so neither namespace is enumerable.
import { put, list, del } from '@vercel/blob';
import { randomBytes } from 'crypto';
import { hashToken } from './feedUtils.js';

export type MagicLinkPurpose = 'login' | 'claim';

export interface MagicLinkRecord {
  emailHash: string;
  purpose: MagicLinkPurpose;
  feedId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AccountIndex {
  emailHash: string;
  feedIds: string[];
  updatedAt: number;
}

/** 32 bytes of CSPRNG, base64url — the raw token that travels in the emailed link URL. */
export function generateLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Blob path for a magic-link record, keyed by the token's hash (raw token never stored). */
export function linkBlobPath(rawToken: string): string {
  return `accounts/links/${hashToken(rawToken)}.json`;
}

/** Blob path for an account's feed index, keyed by emailHash. */
export function indexBlobPath(emailHashHex: string): string {
  return `accounts/index/${emailHashHex}.json`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Create a single-use magic-link record and return the raw token to embed in the email URL.
 */
export async function storeMagicLink(params: {
  emailHash: string;
  purpose: MagicLinkPurpose;
  feedId?: string;
  ttlMs: number;
}): Promise<string> {
  const rawToken = generateLinkToken();
  const now = Date.now();
  const record: MagicLinkRecord = {
    emailHash: params.emailHash,
    purpose: params.purpose,
    feedId: params.feedId,
    createdAt: now,
    expiresAt: now + params.ttlMs
  };
  await put(linkBlobPath(rawToken), JSON.stringify(record), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });
  return rawToken;
}

/**
 * Redeem a magic-link token: validate it exists and is unexpired, then DELETE it (single-use).
 * Returns the record, or null if missing/expired. Deletes expired records as a side effect.
 */
export async function redeemMagicLink(rawToken: string): Promise<MagicLinkRecord | null> {
  const path = linkBlobPath(rawToken);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find(b => b.pathname === path);
  if (!blob) return null;

  const record = await fetchJson<MagicLinkRecord>(blob.url);
  // Always delete on lookup — single-use semantics, and expired records get cleaned up.
  await del(blob.url).catch(() => { /* best-effort */ });

  if (!record || Date.now() > record.expiresAt) return null;
  return record;
}

/** Read an account's feed index (empty list if none). */
export async function getAccountFeedIds(emailHashHex: string): Promise<string[]> {
  const path = indexBlobPath(emailHashHex);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find(b => b.pathname === path);
  if (!blob) return [];
  const index = await fetchJson<AccountIndex>(blob.url);
  return index?.feedIds ?? [];
}

async function writeAccountIndex(emailHashHex: string, feedIds: string[]): Promise<void> {
  const index: AccountIndex = {
    emailHash: emailHashHex,
    feedIds: Array.from(new Set(feedIds)),
    updatedAt: Date.now()
  };
  await put(indexBlobPath(emailHashHex), JSON.stringify(index), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

/** Add a feedId to an account's index (idempotent). */
export async function addFeedToAccount(emailHashHex: string, feedId: string): Promise<void> {
  const current = await getAccountFeedIds(emailHashHex);
  if (current.includes(feedId)) return;
  await writeAccountIndex(emailHashHex, [...current, feedId]);
}

/** Remove a feedId from an account's index (idempotent). */
export async function removeFeedFromAccount(emailHashHex: string, feedId: string): Promise<void> {
  const current = await getAccountFeedIds(emailHashHex);
  if (!current.includes(feedId)) return;
  await writeAccountIndex(emailHashHex, current.filter(id => id !== feedId));
}
