export interface ServerOption {
  readonly value: number;
  readonly label: string;
  readonly host: string;
  readonly port: number;
}

export const SERVER_OPTIONS: readonly ServerOption[] = [
  { value: 0, label: "Chiến Thần", host: "hs1.teamobi.com", port: 19129 },
  { value: 1, label: "Rồng Lửa", host: "hs2.teamobi.com", port: 19129 },
  { value: 2, label: "Global Server", host: "hsglobal.teamobi.com", port: 19129 },
  { value: 3, label: "Phượng Hoàng", host: "hs3.teamobi.com", port: 19129 },
  { value: 4, label: "Nhân Mã", host: "hs5.teamobi.com", port: 19129 },
  { value: 5, label: "Kì Lân", host: "hs6.teamobi.com", port: 19129 },
  { value: 6, label: "Thiên Hà (New)", host: "hs7.teamobi.com", port: 19129 },
  { value: 7, label: "Thách Đấu", host: "hs4.teamobi.com", port: 19129 },
] as const;

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
