'use client';
/**
 * Offline queue for manual entries. iOS has no Background Sync, so entries are kept in
 * localStorage and flushed when the app regains connectivity or comes to the foreground.
 * Each entry carries a client_id so a retried POST can never create a duplicate.
 */
const KEY = 'pl-offline-queue';

export interface QueuedEntry {
  client_id: string;
  amount_cents: number;
  merchant: string;
  card_id: string | null;
  category_id: string | null;
  occurred_at: string;
  note: string | null;
  queued_at: string;
}

export function readQueue(): QueuedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full or blocked */
  }
  window.dispatchEvent(new CustomEvent('pl-queue-changed', { detail: q.length }));
}

export function enqueue(entry: QueuedEntry) {
  writeQueue([...readQueue(), entry]);
}

let flushing = false;
/** Sends queued entries; returns how many were synced. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let synced = 0;
  try {
    for (const entry of readQueue()) {
      try {
        const res = await fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
          credentials: 'same-origin',
        });
        // 4xx other than 401/408/429 means the entry itself is bad — drop it rather than loop forever
        if (res.ok || (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status))) {
          writeQueue(readQueue().filter((e) => e.client_id !== entry.client_id));
          if (res.ok) synced++;
        } else break;
      } catch {
        break; // still offline
      }
    }
  } finally {
    flushing = false;
  }
  return synced;
}

export function newClientId(): string {
  return crypto.randomUUID();
}
