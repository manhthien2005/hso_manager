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
  ApiError,
  CommandFailedError,
  type CommandResult,
  type SendCommandInput,
  type Update,
} from "@/services/api";
import { sanitizeViewerUrl } from "@/lib/format";
import type {
  Account,
  AccountControlUpdate,
  Command,
  CommandType,
  CreateAccountInput,
  CreateFarmSpotInput,
  Device,
  FarmSpot,
  UpdateAccountInput,
  UpdateFarmSpotInput,
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
  accountCreate(deviceId: string) {
    return `account:create:${deviceId}`;
  },
  accountUpdate(accountId: string) {
    return `account:update:${accountId}`;
  },
  accountDelete(accountId: string) {
    return `account:delete:${accountId}`;
  },
  farmSpotsLoad: "farm-spots:load",
  farmSpotCreate: "farm-spots:create",
  farmSpotUpdate(id: string) {
    return `farm-spots:update:${id}`;
  },
  farmSpotDelete(id: string) {
    return `farm-spots:delete:${id}`;
  },
  detectSpots(accountId: string) {
    return `detect-spots:${accountId}`;
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
  farmSpots: FarmSpot[];
  /** True while the initial fleet load is in flight. */
  loadingFleet: boolean;
  pending: Record<string, boolean>;
  isPending(key: string): boolean;

  login(credentials: { username: string; password: string }): Promise<User>;
  logout(): Promise<void>;
  reloadFleet(): Promise<void>;
  refreshDevice(deviceId: string): Promise<Device>;
  runCommand(input: SendCommandInput): Promise<CommandResult>;
  detectSpots(accountId: string): Promise<Command>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  updateAccount(input: UpdateAccountInput): Promise<Account>;
  saveConfig(accountId: string, input: AccountControlUpdate): Promise<Account>;
  deleteAccount(accountId: string): Promise<string>;

  loadFarmSpots(mapId?: number): Promise<FarmSpot[]>;
  createFarmSpot(input: CreateFarmSpotInput): Promise<FarmSpot>;
  updateFarmSpot(id: string, input: UpdateFarmSpotInput): Promise<FarmSpot>;
  deleteFarmSpot(id: string): Promise<string>;

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
  const [farmSpots, setFarmSpots] = useState<FarmSpot[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Provider-lifetime tombstone preventing stale async updates or reloadFleet from resurrecting deleted accounts.
  const deletedAccountIdsRef = useRef<Set<string>>(new Set());

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

    if (update.deletedAccountId) {
      const deletedId = update.deletedAccountId;
      deletedAccountIdsRef.current.add(deletedId);
      setAccounts((current) => current.filter((item) => item.id !== deletedId));
    }

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
      // CRITICAL: If account was deleted/tombstoned, ignore stale update!
      if (deletedAccountIdsRef.current.has(account.id)) {
        return;
      }
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
      const filteredAccounts = nextAccounts.filter(
        (acc) => !deletedAccountIdsRef.current.has(acc.id),
      );
      setDevices(nextDevices);
      setAccounts(filteredAccounts);
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
      if (session) {
        await loadFleet();
      } else {
        setFarmSpots([]);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFleet]);

  const storeViewer = useCallback((deviceId: string, session: ViewerSession) => {
    setViewerSessions((current) => ({ ...current, [deviceId]: session }));
  }, []);

  const executeCommand = useCallback(
    async (accountId: string, type: CommandType): Promise<CommandResult> => {
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
    [applyUpdate, track],
  );

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
        setFarmSpots([]);
        await loadFleet();
        return nextUser;
      },

      async logout() {
        await track(pendingKey.auth, () => api.logout());
        deletedAccountIdsRef.current.clear();
        setUser(null);
        setDevices([]);
        setAccounts([]);
        setViewerSessions({});
        setFarmSpots([]);
      },

      reloadFleet: loadFleet,

      refreshDevice(deviceId) {
        return track(pendingKey.device(deviceId), () => api.refreshDevice(deviceId));
      },

      runCommand({ accountId, type }) {
        return executeCommand(accountId, type);
      },

      async detectSpots(accountId: string) {
        return track(pendingKey.detectSpots(accountId), () =>
          api.detectSpots(accountId),
        );
      },

      async createAccount(input) {
        const created = await track(pendingKey.accountCreate(input.deviceId), () =>
          api.createAccount(input),
        );
        applyUpdate({ account: created });
        return created;
      },

      async updateAccount(input) {
        const updated = await track(pendingKey.accountUpdate(input.accountId), () =>
          api.updateAccount(input),
        );
        applyUpdate({ account: updated });
        return updated;
      },

      async saveConfig(accountId, input) {
        const updated = await track(pendingKey.config(accountId), () =>
          api.updateAccountConfig(accountId, input),
        );
        applyUpdate({ account: updated });
        return updated;
      },

      async deleteAccount(accountId: string) {
        return track(pendingKey.accountDelete(accountId), async () => {
          // 1. Issue fresh Stop using canonical command execution path
          const stopResult = await executeCommand(accountId, "stop");

          // 2. Verify result.command
          if (
            !stopResult?.command?.id ||
            stopResult.command.type !== "stop" ||
            stopResult.command.status !== "success" ||
            stopResult.command.accountId !== accountId
          ) {
            throw new ApiError(
              "INVALID_STOP_PROOF",
              "Fresh stop command did not yield a valid successful proof",
            );
          }

          const stopCommandId = stopResult.command.id;

          // 3. Call api.deleteAccount
          const returnedId = await api.deleteAccount(accountId, stopCommandId);

          // 4. Verify returned ID
          if (returnedId !== accountId) {
            throw new ApiError(
              "DELETE_ACCOUNT",
              `Returned account ID mismatch: expected ${accountId}, got ${returnedId}`,
            );
          }

          // 5. Apply deletion locally (tombstone + filter)
          applyUpdate({ deletedAccountId: accountId });

          return accountId;
        });
      },

      farmSpots,

      async loadFarmSpots(mapId?: number) {
        return track(pendingKey.farmSpotsLoad, async () => {
          const spots = await api.listFarmSpots(mapId);
          if (!mounted.current) return spots;
          if (mapId !== undefined && mapId >= 0) {
            setFarmSpots((current) => {
              const otherMaps = current.filter((s) => s.mapId !== mapId);
              return [...otherMaps, ...spots].sort((a, b) => {
                if (a.mapId !== b.mapId) return a.mapId - b.mapId;
                return a.name.localeCompare(b.name);
              });
            });
          } else {
            setFarmSpots(spots);
          }
          return spots;
        });
      },

      async createFarmSpot(input) {
        const created = await track(pendingKey.farmSpotCreate, () =>
          api.createFarmSpot(input),
        );
        if (mounted.current) {
          setFarmSpots((current) => {
            const next = [...current.filter((s) => s.id !== created.id), created];
            return next.sort((a, b) => {
              if (a.mapId !== b.mapId) return a.mapId - b.mapId;
              return a.name.localeCompare(b.name);
            });
          });
        }
        return created;
      },

      async updateFarmSpot(id, input) {
        const updated = await track(pendingKey.farmSpotUpdate(id), () =>
          api.updateFarmSpot(id, input),
        );
        if (mounted.current) {
          setFarmSpots((current) =>
            current
              .map((item) => (item.id === id ? updated : item))
              .sort((a, b) => {
                if (a.mapId !== b.mapId) return a.mapId - b.mapId;
                return a.name.localeCompare(b.name);
              }),
          );
        }
        return updated;
      },

      async deleteFarmSpot(id) {
        return track(pendingKey.farmSpotDelete(id), async () => {
          const deletedId = await api.deleteFarmSpot(id);
          if (mounted.current) {
            setFarmSpots((current) => current.filter((item) => item.id !== deletedId));
          }
          return deletedId;
        });
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
    executeCommand,
    farmSpots,
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
