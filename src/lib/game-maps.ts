/**
 * Game Map Catalog Facade
 *
 * Exposes the product-facing map catalog for Web consumers.
 * Authoritative map identity and topology derive from Round 9B1 generated facts
 * (src/lib/game-catalog.generated.ts), combined with thin curated metadata
 * (src/lib/game-map-curation.ts).
 */

import {
  GENERATED_GAME_MAPS,
  type GeneratedGameMap,
} from "./game-catalog.generated";
import {
  GAME_MAP_DISPLAY_OVERRIDES,
  GAME_MAP_NOTES,
} from "./game-map-curation";

export interface GameMapOption {
  readonly id: number;
  readonly name: string;
  readonly travelSupported: boolean;
  readonly notes?: string;
}

function resolveMapName(genMap: GeneratedGameMap): string {
  const override = GAME_MAP_DISPLAY_OVERRIDES[genMap.id];
  if (override) {
    if (genMap.rawNameVi !== override.expectedRawNameVi) {
      throw new Error(
        `Curated display override raw value mismatch for Map ${genMap.id}: expected ${JSON.stringify(
          override.expectedRawNameVi,
        )}, got ${JSON.stringify(genMap.rawNameVi)}`,
      );
    }
    return override.displayName;
  }

  if (genMap.rawNameVi === null || genMap.rawNameVi.trim().length === 0) {
    throw new Error(
      `Map ${genMap.id} has null or empty rawNameVi with no explicit curated display override`,
    );
  }

  return genMap.rawNameVi;
}

function buildGameMaps(): readonly GameMapOption[] {
  return GENERATED_GAME_MAPS.map((genMap) => {
    const name = resolveMapName(genMap);
    const note = GAME_MAP_NOTES[genMap.id];
    return {
      id: genMap.id,
      name,
      travelSupported: genMap.travelEligible,
      ...(note !== undefined ? { notes: note } : {}),
    };
  });
}

export const GAME_MAPS: readonly GameMapOption[] = buildGameMaps();

export const GAME_MAP_BY_ID = new Map<number, GameMapOption>(
  GAME_MAPS.map((map) => [map.id, map]),
);

export const TRAVEL_SUPPORTED_MAPS: readonly GameMapOption[] =
  GAME_MAPS.filter((map) => map.travelSupported);

export function getGameMap(id: number): GameMapOption | undefined {
  return GAME_MAP_BY_ID.get(id);
}

export function formatGameMap(id: number): string {
  const map = GAME_MAP_BY_ID.get(id);
  if (map) {
    return `[${map.id}] ${map.name}`;
  }
  return `Unknown map [${id}]`;
}
