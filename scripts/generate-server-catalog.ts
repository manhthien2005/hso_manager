/**
 * Reproducible Stable Server Catalog Generator
 *
 * Extracts authoritative stable logical SERVER_CATALOG facts from knight_build.
 * Usage:
 *   node scripts/generate-server-catalog.ts [--source-root <path-to-knight_build>]
 *
 * Authoritative Sources in knight_build:
 *   - tool/crates/zeus-core/src/rms.rs (SERVER_CATALOG, SERVER_COUNT)
 *   - vendor/game/zeus-jar.json (CTL_VERSION: 15, jar_sha256)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";

export interface ServerEntry {
  logicalId: number;
  name: string;
  host: string;
  port: number;
  lang: number;
}

export interface CatalogMetadata {
  sourceRepository: string;
  sourceCommit: string;
  sourceJarSha256: string;
  ctlVersion: number;
  sourcePath: string;
  serverCount: number;
}

const FROZEN_LEGACY_SERVERS: readonly ServerEntry[] = [
  { logicalId: 0, name: "Chiến Thần", host: "hs1.teamobi.com", port: 19129, lang: 0 },
  { logicalId: 1, name: "Rồng Lửa", host: "hs2.teamobi.com", port: 19129, lang: 0 },
  { logicalId: 2, name: "Global Server", host: "hsglobal.teamobi.com", port: 19129, lang: 1 },
  { logicalId: 3, name: "Phượng Hoàng", host: "hs3.teamobi.com", port: 19129, lang: 0 },
  { logicalId: 4, name: "Nhân Mã", host: "hs5.teamobi.com", port: 19129, lang: 0 },
  { logicalId: 5, name: "Kì Lân", host: "hs6.teamobi.com", port: 19129, lang: 0 },
  { logicalId: 6, name: "Thiên Hà (New)", host: "hs7.teamobi.com", port: 19129, lang: 0 },
  { logicalId: 7, name: "Thách Đấu", host: "hs4.teamobi.com", port: 19129, lang: 0 },
];

export function resolveSourceRoot(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source-root" && i + 1 < args.length) {
      return path.resolve(args[i + 1]);
    }
  }

  // Fallback heuristics: check ../docker-build, ../knight_build
  const candidates = [
    path.resolve(process.cwd(), "../docker-build"),
    path.resolve(process.cwd(), "../knight_build"),
    path.resolve(process.cwd(), "../../docker-build"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "tool/crates/zeus-core/src/rms.rs"))) {
      return candidate;
    }
  }

  throw new Error(
    "Could not locate knight_build source root. Please provide --source-root <path-to-knight_build>."
  );
}

export function parseServerCatalog(sourceRoot: string): { servers: ServerEntry[]; metadata: CatalogMetadata } {
  const rmsPath = path.join(sourceRoot, "tool/crates/zeus-core/src/rms.rs");
  const manifestPath = path.join(sourceRoot, "vendor/game/zeus-jar.json");

  if (!fs.existsSync(rmsPath)) {
    throw new Error(`rms.rs not found at ${rmsPath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`zeus-jar.json not found at ${manifestPath}`);
  }

  // 1. Read zeus-jar.json
  const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);
  const jarSha256 = manifest.jar_sha256;
  const ctlVersion = manifest.ctl_version;

  if (typeof jarSha256 !== "string" || jarSha256.length !== 64) {
    throw new Error(`Invalid or missing jar_sha256 in ${manifestPath}: ${jarSha256}`);
  }
  if (ctlVersion !== 15) {
    throw new Error(`Expected CTL_VERSION 15 in ${manifestPath}, got ${ctlVersion}`);
  }

  // 2. Read git metadata from sourceRoot
  let gitRemote = "https://github.com/manhthien2005/knight_build";
  try {
    const remoteOut = childProcess.execSync("git remote get-url origin", {
      cwd: sourceRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (remoteOut) gitRemote = remoteOut;
  } catch {
    // Keep fallback
  }

  let gitCommit = "";
  try {
    gitCommit = childProcess.execSync("git rev-parse HEAD", {
      cwd: sourceRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    throw new Error(`Failed to get git commit from ${sourceRoot}: ${err}`);
  }

  // 3. Parse rms.rs
  const rmsContent = fs.readFileSync(rmsPath, "utf-8");

  // Validate SERVER_COUNT
  const countMatch = rmsContent.match(/pub\s+const\s+SERVER_COUNT\s*:\s*u8\s*=\s*(\d+);/);
  if (!countMatch) {
    throw new Error("Could not find pub const SERVER_COUNT in rms.rs");
  }
  const declaredCount = Number(countMatch[1]);
  if (declaredCount !== 9) {
    throw new Error(`Expected SERVER_COUNT 9 in rms.rs, got ${declaredCount}`);
  }

  // Extract ServerSpec entries
  const entryRegex = /ServerSpec\s*\{\s*logical_id\s*:\s*(\d+)\s*,\s*name\s*:\s*"([^"]+)"\s*,\s*host\s*:\s*"([^"]+)"\s*,\s*port\s*:\s*(\d+)\s*,\s*lang\s*:\s*(\d+)\s*,?\s*\}/g;
  const servers: ServerEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(rmsContent)) !== null) {
    servers.push({
      logicalId: Number(match[1]),
      name: match[2],
      host: match[3],
      port: Number(match[4]),
      lang: Number(match[5]),
    });
  }

  if (servers.length !== declaredCount) {
    throw new Error(`Parsed ${servers.length} ServerSpec entries, expected ${declaredCount}`);
  }

  // 4. Validate dense logical IDs 0..8
  for (let i = 0; i < servers.length; i++) {
    if (servers[i].logicalId !== i) {
      throw new Error(`Non-dense logical ID at index ${i}: expected ${i}, got ${servers[i].logicalId}`);
    }
  }

  // 5. Validate unique hosts
  const hostSet = new Set(servers.map((s) => s.host));
  if (hostSet.size !== servers.length) {
    throw new Error(`Duplicate host found in SERVER_CATALOG: ${servers.map((s) => s.host).join(", ")}`);
  }

  // 6. Validate frozen legacy IDs 0..7
  for (let i = 0; i < FROZEN_LEGACY_SERVERS.length; i++) {
    const expected = FROZEN_LEGACY_SERVERS[i];
    const actual = servers[i];
    if (
      actual.logicalId !== expected.logicalId ||
      actual.name !== expected.name ||
      actual.host !== expected.host ||
      actual.port !== expected.port ||
      actual.lang !== expected.lang
    ) {
      throw new Error(
        `Legacy server ${i} altered: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }

  // 7. Validate ID 8 is Bạch Hổ New
  const bachHo = servers[8];
  if (
    bachHo.logicalId !== 8 ||
    bachHo.name !== "Bạch Hổ New" ||
    bachHo.host !== "hs8.teamobi.com" ||
    bachHo.port !== 19129 ||
    bachHo.lang !== 0
  ) {
    throw new Error(`Logical server 8 is not Bạch Hổ New: ${JSON.stringify(bachHo)}`);
  }

  const metadata: CatalogMetadata = {
    sourceRepository: gitRemote,
    sourceCommit: gitCommit,
    sourceJarSha256: jarSha256,
    ctlVersion,
    sourcePath: "tool/crates/zeus-core/src/rms.rs",
    serverCount: servers.length,
  };

  return { servers, metadata };
}

export function generateSource(data: { servers: ServerEntry[]; metadata: CatalogMetadata }): string {
  return `/**
 * AUTOGENERATED STABLE SERVER CATALOG FACT REPOSITORY
 * DO NOT EDIT MANUALLY
 *
 * Generated by: scripts/generate-server-catalog.ts
 *
 * PROVENANCE:
 *   source repository: ${data.metadata.sourceRepository}
 *   source commit:     ${data.metadata.sourceCommit}
 *   source path:       ${data.metadata.sourcePath}
 *   source jar sha256: ${data.metadata.sourceJarSha256}
 *   CTL_VERSION:       ${data.metadata.ctlVersion}
 *   servers:           ${data.metadata.serverCount}
 */

export interface GeneratedServerEntry {
  readonly logicalId: number;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly lang: number;
}

export interface GeneratedServerCatalogMetadata {
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly sourceJarSha256: string;
  readonly ctlVersion: number;
  readonly sourcePath: string;
  readonly serverCount: number;
}

export const GENERATED_SERVER_CATALOG_METADATA: GeneratedServerCatalogMetadata = ${JSON.stringify(data.metadata, null, 2)} as const;

export const STABLE_SERVER_CATALOG: readonly GeneratedServerEntry[] = ${JSON.stringify(data.servers, null, 2)} as const;

export const STABLE_SERVER_BY_LOGICAL_ID: ReadonlyMap<number, GeneratedServerEntry> = new Map(
  STABLE_SERVER_CATALOG.map((server) => [server.logicalId, server]),
);
`;
}

function main(): void {
  const sourceRoot = resolveSourceRoot(process.argv.slice(2));
  console.log(`[generate-server-catalog] Using source root: ${sourceRoot}`);

  const catalog = parseServerCatalog(sourceRoot);
  console.log(
    `[generate-server-catalog] Successfully parsed ${catalog.servers.length} servers from ${catalog.metadata.sourceCommit}`
  );

  const outputPath = path.resolve(process.cwd(), "src/lib/server-catalog.generated.ts");
  const code = generateSource(catalog);

  fs.writeFileSync(outputPath, code, "utf-8");
  console.log(`[generate-server-catalog] Generated -> ${outputPath}`);
}

import * as url from "node:url";

const currentFilePath = url.fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath);
if (isMain) {
  main();
}
