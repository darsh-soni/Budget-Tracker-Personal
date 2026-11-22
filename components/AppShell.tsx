'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TabBar } from './TabBar';
import { AddSheet } from './AddSheet';
import { EditSheet } from './EditSheet';
import { InstallPrompt } from './InstallPrompt';
import { flushQueue, readQueue } from '@/lib/client/queue';
import { refreshAll, useBootstrap } from '@/lib/client/data';
import { api } from '@/lib/client/api';
import type { Transaction } from '@/lib/types';

interface ShellApi {
  openAdd: () => void;
  openEdit: (tx: Transaction) => void;
  toast: (msg: string) => void;
  pending: number;
}
const ShellCtx = createContext<ShellApi>({ openAdd: () => {}, openEdit: () => {}, toast: () => {}, pending: 0 });
export const useShell = () => useContext(ShellCtx);

const CHROMELESS = ['/login', '/offline', '/auth'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const chromeless = CHROMELESS.some((p) => path.startsWith(p));
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const proxyRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const openAdd = useCallback(() => {
    // iOS only shows the keyboard if focus happens inside the tap handler:
    // focus a hidden decimal input now, the sheet moves focus to the amount field.
    proxyRef.current?.focus();
    setAddOpen(true);
  }, []);

  // service worker + offline queue
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
    const sync = async () => {
      setPending(readQueue().length);
      const n = await flushQueue();
      if (n) { toast(`Synced ${n} offline ${n === 1 ? 'entry' : 'entries'}`); refreshAll(); }
    };
    const onOnline = () => { setOnline(true); sync(); };
    const onOffline = () => setOnline(false);
    const onQueue = (e: Event) => setPending((e as CustomEvent<number>).detail);
    const onVisible = () => document.visibilityState === 'visible' && sync();
    setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pl-queue-changed', onQueue);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pl-queue-changed', onQueue);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [toast]);

  return (
    <ShellCtx.Provider value={{ openAdd, openEdit: setEditing, toast, pending }}>
      {!online && <div className="offline-pill">Offline{pending ? ` · ${pending} queued` : ''}</div>}
      {children}
      {!chromeless && (
        <>
          <ShellEffects onAdd={openAdd} />
          <TabBar onAdd={openAdd} />
          <AddSheet open={addOpen} onClose={() => setAddOpen(false)} toast={toast} />
          <EditSheet tx={editing} onClose={() => setEditing(null)} toast={toast} />
          <InstallPrompt />
        </>
      )}
      <input
        ref={proxyRef}
        aria-hidden
        tabIndex={-1}
        inputMode="decimal"
        style={{ position: 'fixed', top: 0, left: 0, opacity: 0, height: 0, width: 0, fontSize: 16, pointerEvents: 'none' }}
      />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </ShellCtx.Provider>
  );
}

/** Small side effects that need the signed-in user: keep the timezone in sync, handle ?add=1. */
function ShellEffects({ onAdd }: { onAdd: () => void }) {
  const { data } = useBootstrap();
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (data?.user && tz && data.user.timezone !== tz) {
      api('/api/settings', { method: 'PATCH', body: { timezone: tz } }).then(() => refreshAll()).catch(() => {});
    }
  }, [data?.user]);
  useEffect(() => {
    if (params.get('add') === '1') {
      onAdd();
      router.replace('/');
    }
  }, [params, onAdd, router]);
  return null;
}
