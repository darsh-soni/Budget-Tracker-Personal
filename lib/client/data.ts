'use client';
import useSWR, { mutate } from 'swr';
import { fetcher } from './api';
import type { Bootstrap } from '../types';

export function useBootstrap(month?: string) {
  const key = `/api/bootstrap${month ? `?month=${month}` : ''}`;
  return useSWR<Bootstrap>(key, fetcher, { revalidateOnFocus: true, keepPreviousData: true });
}

/** Revalidate every cached bootstrap / transaction query after a write. */
export function refreshAll() {
  return mutate((key) => typeof key === 'string' && (key.startsWith('/api/bootstrap') || key.startsWith('/api/transactions')));
}
