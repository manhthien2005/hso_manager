/**
 * Canonical Mount Catalog — Storm Steel / Zeus Client.
 *
 * Grounded in:
 * - Native whitelist: fr.java:603, Zeus.java:5477, Assembly-CSharp.dll:isNgua (IDs 62..66)
 * - Canonical client template names: MountTemplate constants & unity_consts.txt
 *     0=NGUA_NAU (Ngựa nâu), 1=NGUA_TRANG (Ngựa trắng), 2=NGUA_CHIENGIAP (Ngựa chiến giáp),
 *     3=NGUA_DO (Ngựa xích thố / Ngựa đỏ), 4=NGUA_DEN (Ngựa đen)
 * - Observed live telemetry: zeus-player.txt:22 ("63:Ngựa trắng|65:Ngựa xích thố|66:Ngựa đen")
 */

export interface MountItem {
  readonly id: number;
  readonly name: string;
}

export const MOUNT_CATALOG: readonly MountItem[] = [
  { id: 0, name: "Bất kỳ (Thú cưỡi có sẵn)" },
  { id: 62, name: "Ngựa nâu" },
  { id: 63, name: "Ngựa trắng" },
  { id: 64, name: "Ngựa chiến giáp" },
  { id: 65, name: "Ngựa xích thố" },
  { id: 66, name: "Ngựa đen" },
] as const;

/**
 * Maps each mount ID to its canonical Vietnamese display name.
 */
export const MOUNT_NAMES: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries(MOUNT_CATALOG.map((m) => [m.id, m.name]))
);

/**
 * Parses carried mount IDs from Zeus telemetry string (format "id:name|id:name").
 * Returns an array of carried numeric template IDs.
 */
export function parseCarriedMountIds(telemetryMounts?: string | null): number[] {
  if (!telemetryMounts || typeof telemetryMounts !== "string") {
    return [];
  }
  const ids: number[] = [];
  for (const part of telemetryMounts.split("|")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    const idStr = colonIdx === -1 ? trimmed : trimmed.substring(0, colonIdx);
    const num = Number(idStr);
    if (Number.isInteger(num) && num > 0) {
      ids.push(num);
    }
  }
  return ids;
}

/**
 * Returns the display label for a mount option, optionally decorated with inventory status.
 */
export function getMountDisplayLabel(
  id: number,
  carriedIds?: ReadonlySet<number> | readonly number[] | null
): string {
  const name = MOUNT_NAMES[id] ?? `Thú #${id}`;
  if (id === 0) {
    return name;
  }
  const isCarried =
    carriedIds instanceof Set
      ? carriedIds.has(id)
      : Array.isArray(carriedIds)
      ? carriedIds.includes(id)
      : false;
  return isCarried ? `${name} (Trong hành trang)` : name;
}
