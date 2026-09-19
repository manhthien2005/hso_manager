"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  CommandFailedError,
  type CommandResult,
  type SendCommandInput,
  type Update,
} from "@/services/api";
import { sanitizeViewerUrl } from "@/lib/format";
import type {
  Account,
  AccountControlUpdate,
  CommandType,
  Device,
  User,
  ViewerSession,
} from "@/lib/types";

/**
 * Single client-side data store for the whole app.
 *
 * Components never call `api` directly: they read `devices` / `accounts` /
 * `viewerSessions` here and invoke actions. That keeps the Supabase swap inside
 * `services/api.ts`.
 *
 * `pending` tracks in-flight work per key so a button can show its own spinner
 * without local state duplicating the request lifecycle.
 *
 * Viewer sessions are fetched with the fleet (not per page mount) so the viewer
 * page needs no effect of its own.
 */

/** Key builders shared by the store and by components reading `pending`. */
export const pendingKey = {
  auth: "auth",
  command(accountId: string, type: CommandType) {
    return `command:${accountId}:${type}`;
  },
  config(accountId: string) {
    return `config:${accountId}`;
  },
  device(deviceId: string) {
    return `device:${deviceId}`;
  },
  viewer(deviceId: string) {
    return `viewer:${deviceId}`;
  },
} as const;

interface ZeusStoreValue {
  /** True once the session lookup and initial fleet load settled. */
  ready: boolean;
  user: User | null;
  devices: Device[];
  accounts: Account[];
  /** Viewer session keyed by `deviceId`; absent when none is open. */
  viewerSessions: Record<string, ViewerSession>;
  /** True while the initial fleet load is in flight. */
  loadingFleet: boolean;
  pending: Record<string, boolean>;
  isPending(key: string): boolean;

  login(credentials: { username: string; password: string }): Promise<User>;
  logout(): Promise<void>;
  reloadFleet(): Promise<void>;
  refreshDevice(deviceId: string): Promise<Device>;
  runCommand(input: SendCommandInput): Promise<CommandResult>;
  saveConfig(accountId: string, input: AccountControlUpdate): Promise<Account>;

  connectViewer(deviceId: string): Promise<ViewerSession>;
  disconnectViewer(deviceId: string): Promise<ViewerSession>;

  getDevice(deviceId: string): Device | undefined;
  getAccount(accountId: string): Account | undefined;
  viewerSessionOf(deviceId: string): ViewerSession | undefined;
  accountsOf(deviceId: string): Account[];
}

const ZeusStoreContext = createContext<ZeusStoreValue | null>(null);

export function ZeusStoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [viewerSessions, setViewerSessions] = useState<Record<string, ViewerSession>>({});
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Guards every async write so an unmounted provider can't set state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setPendingKey = useCallback((key: string, value: boolean) => {
    setPending((current) => {
      if (Boolean(current[key]) === value) return current;
      const next = { ...current };
      if (value) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);

  const track = useCallback(
    async <T,>(key: string, work: () => Promise<T>): Promise<T> => {
      setPendingKey(key, true);
      try {
        return await work();
      } finally {
        setPendingKey(key, false);
      }
    },
    [setPendingKey],
  );

  const applyUpdate = useCallback((update: Update) => {
    if (!mounted.current) return;
    if (update.device) {
      const device = update.device;
      setDevices((current) => {
        const index = current.findIndex((item) => item.id === device.id);
        if (index === -1) return [...current, device];
        if (current[index] === device) return current;
        return current.map((item, i) => (i === index ? device : item));
      });
      if (device.viewer_url) {
        setViewerSessions((current) => ({
          ...current,
          [device.deviceId]: {
            id: `viewer-${device.deviceId}`,
            deviceId: device.deviceId,
            url: sanitizeViewerUrl(device.viewer_url),
            transport: "novnc" as const,
            state: "connected" as const,
            createdAt: Date.now(),
            reason: null,
          },
        }));
      } else {
        setViewerSessions((current) => {
          if (!current[device.deviceId]) return current;
          return {
            ...current,
            [device.deviceId]: {
              id: `viewer-${device.deviceId}`,
              deviceId: device.deviceId,
              url: null,
              transport: "novnc" as const,
              state: "closed" as const,
              createdAt: Date.now(),
              reason: null,
            },
          };
        });
      }
    }
    if (update.account) {
      const account = update.account;
      setAccounts((current) => {
        const index = current.findIndex((item) => item.id === account.id);
        if (index === -1) return [...current, account];
        if (current[index] === account) return current;
        return current.map((item, i) => (i === index ? account : item));
      });
    }
  }, []);

  // Realtime seam: the mock emits from its metrics timer; Supabase will emit
  // from a postgres_changes subscription with the same payload shape.
  useEffect(() => api.onUpdate(applyUpdate), [applyUpdate]);

  const loadFleet = useCallback(async () => {
    setLoadingFleet(true);
    try {
      const [nextDevices, nextAccounts] = await Promise.all([
        api.getDevices(),
        api.getAccounts(),
      ]);
      // One session lookup per device keeps the viewer page effect-free.
      const sessions = await Promise.all(
        nextDevices.map((device) => api.getViewerSession(device.deviceId)),
      );
      if (!mounted.current) return;
      setDevices(nextDevices);
      setAccounts(nextAccounts);
      setViewerSessions(
        Object.fromEntries(
          sessions
            .map((session, index) => [nextDevices[index]!.deviceId, session] as const)
            .filter((entry): entry is readonly [string, ViewerSession] => entry[1] !== null),
        ),
      );
    } finally {
      if (mounted.current) setLoadingFleet(false);
    }
  }, []);

  // Session bootstrap: resolve the mock session, then pull the fleet once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await api.getSession();
      if (cancelled) return;
      setUser(session);
      if (session) await loadFleet();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFleet]);

  const storeViewer = useCallback((deviceId: string, session: ViewerSession) => {
    setViewerSessions((current) => ({ ...current, [deviceId]: session }));
  }, []);

  const value = useMemo<ZeusStoreValue>(() => {
    const deviceIndex = new Map(devices.map((device) => [device.deviceId, device]));
    const accountIndex = new Map(accounts.map((account) => [account.id, account]));

    return {
      ready,
      user,
      devices,
      accounts,
      viewerSessions,
      loadingFleet,
      pending,
      isPending: (key) => pending[key] === true,

      async login(credentials) {
        const nextUser = await track(pendingKey.auth, () => api.login(credentials));
        setUser(nextUser);
        await loadFleet();
        return nextUser;
      },

      async logout() {
        await track(pendingKey.auth, () => api.logout());
        setUser(null);
        setDevices([]);
        setAccounts([]);
        setViewerSessions({});
      },

      reloadFleet: loadFleet,

      refreshDevice(deviceId) {
        return track(pendingKey.device(deviceId), () => api.refreshDevice(deviceId));
      },

      async runCommand({ accountId, type }) {
        return track(pendingKey.command(accountId, type), async () => {
          try {
            const result = await api.sendCommand({ accountId, type });
            applyUpdate({ account: result.account, device: result.device });
            return result;
          } catch (error) {
            if (error instanceof CommandFailedError) {
              applyUpdate({
                account: error.result.account,
                device: error.result.device,
              });
            }
            throw error;
          }
        });
      },

      async saveConfig(accountId, input) {
        const updated = await track(pendingKey.config(accountId), () =>
          api.updateAccountConfig(accountId, input),
        );
        applyUpdate({ account: updated });
        return updated;
      },

      async connectViewer(deviceId) {
        const session = await track(pendingKey.viewer(deviceId), () =>
          api.connectViewer(deviceId),
        );
        storeViewer(deviceId, session);
        return session;
      },

      async disconnectViewer(deviceId) {
        const session = await track(pendingKey.viewer(deviceId), () =>
          api.disconnectViewer(deviceId),
        );
        storeViewer(deviceId, session);
        return session;
      },

      getDevice: (deviceId) => deviceIndex.get(deviceId),
      getAccount: (accountId) => accountIndex.get(accountId),
      viewerSessionOf: (deviceId) => viewerSessions[deviceId],
      accountsOf: (deviceId) => accounts.filter((account) => account.deviceId === deviceId),
    };
  }, [
    accounts,
    applyUpdate,
    devices,
    loadFleet,
    loadingFleet,
    pending,
    ready,
    storeViewer,
    track,
    user,
    viewerSessions,
  ]);

  return <ZeusStoreContext.Provider value={value}>{children}</ZeusStoreContext.Provider>;
}

export function useZeusStore(): ZeusStoreValue {
  const context = useContext(ZeusStoreContext);
  if (context === null) {
    throw new Error("useZeusStore must be used inside <ZeusStoreProvider>");
  }
  return context;
}
