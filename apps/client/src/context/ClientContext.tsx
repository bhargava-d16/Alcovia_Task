/**
 * ClientContext — provides per-client identity and online/offline state.
 *
 * Client ID is derived from the URL search param: ?client=A or ?client=B
 * This is how two browser tabs run as independent "devices" on the same origin.
 *
 * IMPORTANT: isOnline controls whether network calls are made.
 * When offline, all sync operations queue locally. This is distinct from
 * the actual network being down — it's a simulated offline state for demo.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { LocalStore } from '@alcovia/sync-engine';

interface ClientContextValue {
  clientId: string;
  studentId: string;
  isOnline: boolean;
  setOnline: (online: boolean) => void;
  store: LocalStore;
}

const ClientContext = createContext<ClientContextValue | null>(null);

function getClientIdFromURL(): string {
  if (typeof window === 'undefined') return 'A';
  const param = new URLSearchParams(window.location.search).get('client');
  return param ?? 'A';
}

export function ClientProvider({ children }: { children: ReactNode }) {
  const clientId = getClientIdFromURL();
  const studentId = 'student_001'; // hardcoded per spec
  const [isOnline, setIsOnline] = useState(true);

  // One store instance per client — stable across renders
  const [store] = useState(() => new LocalStore(clientId));

  return (
    <ClientContext.Provider
      value={{ clientId, studentId, isOnline, setOnline: setIsOnline, store }}
    >
      {children}
    </ClientContext.Provider>
  );
}

export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used within <ClientProvider>');
  return ctx;
}
