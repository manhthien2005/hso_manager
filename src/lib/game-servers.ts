/**
 * Game Server Catalog Facade
 *
 * Exposes server options and display helpers for Web consumers.
 * Authoritative server identity (logical ID, name, host, port, lang) derives
 * from the stable SERVER_CATALOG in knight_build zeus-core
 * (src/lib/server-catalog.generated.ts).
 */

import {
  STABLE_SERVER_CATALOG,
  STABLE_SERVER_BY_LOGICAL_ID,
  type GeneratedServerEntry,
} from "./server-catalog.generated";

export const DEFAULT_GAME_SERVER_PORT = 19129;
export const BACH_HO_LOGICAL_ID = 8;

export interface ServerOption {
  readonly value: number;
  readonly label: string;
  readonly host: string;
  readonly port: number;
  readonly lang: number;
}

function buildServerOptions(): readonly ServerOption[] {
  return STABLE_SERVER_CATALOG.map((server: GeneratedServerEntry) => ({
    value: server.logicalId,
    label: server.name,
    host: server.host,
    port: server.port,
    lang: server.lang,
  }));
}

export const SERVER_OPTIONS: readonly ServerOption[] = buildServerOptions();

export const SERVER_NAME_BY_INDEX: Readonly<Record<number, string>> =
  Object.fromEntries(
    SERVER_OPTIONS.map((server) => [server.value, server.label]),
  );

/**
 * Validates whether an unknown value is a valid server logical ID (0..8).
 */
export function isValidServerIndex(index: unknown): index is number {
  return typeof index === "number" && Number.isInteger(index) && STABLE_SERVER_BY_LOGICAL_ID.has(index);
}

export function getServerOption(index: number): ServerOption | undefined {
  return SERVER_OPTIONS.find((server) => server.value === index);
}

export function getServerName(index: number): string | null {
  return SERVER_NAME_BY_INDEX[index] ?? null;
}

export function getServerHost(index: number): string | null {
  return STABLE_SERVER_BY_LOGICAL_ID.get(index)?.host ?? null;
}

export function getServerPort(index: number): number | null {
  return STABLE_SERVER_BY_LOGICAL_ID.get(index)?.port ?? null;
}

export function getServerLang(index: number): number | null {
  return STABLE_SERVER_BY_LOGICAL_ID.get(index)?.lang ?? null;
}

export function formatServerDisplay(serverId: number | null): string {
  if (serverId === null) return "—";
  return SERVER_NAME_BY_INDEX[serverId] ?? `Không xác định (${serverId})`;
}
