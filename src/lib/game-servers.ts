/**
 * Game Server Catalog Facade
 *
 * Exposes server options and display helpers for Web consumers.
 * Authoritative server identity (index, name, host) derives from Round 9B1
 * generated facts (src/lib/game-catalog.generated.ts).
 * Port policy is preserved as Web runtime connection policy (19129).
 */

import {
  GENERATED_GAME_SERVERS,
  type GeneratedGameServer,
} from "./game-catalog.generated";

export const DEFAULT_GAME_SERVER_PORT = 19129;

export interface ServerOption {
  readonly value: number;
  readonly label: string;
  readonly host: string;
  readonly port: number;
}

function buildServerOptions(): readonly ServerOption[] {
  return GENERATED_GAME_SERVERS.map((server: GeneratedGameServer) => ({
    value: server.index,
    label: server.name,
    host: server.host,
    port: DEFAULT_GAME_SERVER_PORT,
  }));
}

export const SERVER_OPTIONS: readonly ServerOption[] = buildServerOptions();

export const SERVER_NAME_BY_INDEX: Readonly<Record<number, string>> =
  Object.fromEntries(
    SERVER_OPTIONS.map((server) => [server.value, server.label]),
  );

export function getServerOption(index: number): ServerOption | undefined {
  return SERVER_OPTIONS.find((server) => server.value === index);
}

export function getServerName(index: number): string | null {
  return SERVER_NAME_BY_INDEX[index] ?? null;
}

export function formatServerDisplay(serverId: number | null): string {
  if (serverId === null) return "—";
  return SERVER_NAME_BY_INDEX[serverId] ?? `Unknown (${serverId})`;
}
