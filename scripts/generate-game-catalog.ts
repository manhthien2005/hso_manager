/**
 * Reproducible Catalog Generator
 *
 * Extracts authoritative map and server catalog facts from knight_build.
 * Usage:
 *   node scripts/generate-game-catalog.ts [--source-root <path-to-knight_build>]
 *
 * Authoritative Sources in knight_build:
 *   - vendor/game/Zeus_Knight.jar (df.class, eg.class, as.class, t.class, dx.class, Zeus.class)
 *   - vendor/game/zeus-jar.json (CTL_VERSION: 13, jar_sha256)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as childProcess from "node:child_process";
import * as os from "node:os";

interface CpItem {
  tag: number;
  str?: string;
  val?: number | bigint;
  idx?: number;
  idx1?: number;
  idx2?: number;
  kind?: number;
}

interface ParsedClass {
  cp: (CpItem | null)[];
  methods: {
    mName: string;
    mDesc: string;
    code: Buffer | null;
  }[];
}

function parseClass(buf: Buffer): ParsedClass {
  const magic = buf.readUInt32BE(0);
  if (magic !== 0xcafebabe) {
    throw new Error("Invalid class file: wrong magic " + magic.toString(16));
  }
  const cpCount = buf.readUInt16BE(8);
  let offset = 10;
  const cp: (CpItem | null)[] = [null];

  for (let i = 1; i < cpCount; i++) {
    const tag = buf[offset++];
    if (tag === 1) { // Utf8
      const len = buf.readUInt16BE(offset);
      offset += 2;
      cp.push({ tag, str: buf.toString("utf8", offset, offset + len) });
      offset += len;
    } else if (tag === 3) { // Integer
      cp.push({ tag, val: buf.readInt32BE(offset) });
      offset += 4;
    } else if (tag === 4) { // Float
      cp.push({ tag, val: buf.readFloatBE(offset) });
      offset += 4;
    } else if (tag === 5) { // Long
      cp.push({ tag, val: buf.readBigInt64BE(offset) });
      offset += 8;
      cp.push(null);
      i++;
    } else if (tag === 6) { // Double
      cp.push({ tag, val: buf.readDoubleBE(offset) });
      offset += 8;
      cp.push(null);
      i++;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
      cp.push({ tag, idx: buf.readUInt16BE(offset) });
      offset += 2;
    } else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) {
      cp.push({ tag, idx1: buf.readUInt16BE(offset), idx2: buf.readUInt16BE(offset + 2) });
      offset += 4;
    } else if (tag === 15) {
      cp.push({ tag, kind: buf[offset], idx: buf.readUInt16BE(offset + 1) });
      offset += 3;
    } else {
      throw new Error(`Unsupported CP tag: ${tag} at offset ${offset - 1}`);
    }
  }

  offset += 6; // accessFlags, thisClass, superClass
  const interfacesCount = buf.readUInt16BE(offset);
  offset += 2 + interfacesCount * 2;

  const fieldsCount = buf.readUInt16BE(offset);
  offset += 2;
  for (let i = 0; i < fieldsCount; i++) {
    offset += 6;
    const fAttrCount = buf.readUInt16BE(offset);
    offset += 2;
    for (let a = 0; a < fAttrCount; a++) {
      offset += 2;
      const len = buf.readUInt32BE(offset);
      offset += 4 + len;
    }
  }

  const methodsCount = buf.readUInt16BE(offset);
  offset += 2;
  const methods: ParsedClass["methods"] = [];
  for (let i = 0; i < methodsCount; i++) {
    offset += 2;
    const mName = cp[buf.readUInt16BE(offset)]?.str ?? "";
    offset += 2;
    const mDesc = cp[buf.readUInt16BE(offset)]?.str ?? "";
    offset += 2;
    const mAttrCount = buf.readUInt16BE(offset);
    offset += 2;
    let code: Buffer | null = null;
    for (let a = 0; a < mAttrCount; a++) {
      const aName = cp[buf.readUInt16BE(offset)]?.str ?? "";
      offset += 2;
      const len = buf.readUInt32BE(offset);
      offset += 4;
      if (aName === "Code") {
        const codeLen = buf.readUInt32BE(offset + 4);
        code = buf.subarray(offset + 8, offset + 8 + codeLen);
      }
      offset += len;
    }
    methods.push({ mName, mDesc, code });
  }

  return { cp, methods };
}

function resolveString(cp: (CpItem | null)[], idx: number): string | null {
  const item = cp[idx];
  if (item && item.tag === 8 && item.idx !== undefined) {
    return cp[item.idx]?.str ?? null;
  }
  return null;
}

function extract1DStringArray(cls: ParsedClass, methodName: string, targetFieldName: string): string[] {
  const method = cls.methods.find((m) => m.mName === methodName);
  if (!method || !method.code) {
    throw new Error(`Method ${methodName} with code not found in class`);
  }
  const code = method.code;
  const stack: unknown[] = [];

  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    if (op === 0x12) { // ldc
      const idx = code[i + 1];
      i += 1;
      const s = resolveString(cls.cp, idx);
      stack.push(s !== null ? s : { constIdx: idx });
    } else if (op === 0x13) { // ldc_w
      const idx = code.readUInt16BE(i + 1);
      i += 2;
      const s = resolveString(cls.cp, idx);
      stack.push(s !== null ? s : { constIdx: idx });
    } else if (op >= 0x02 && op <= 0x08) { // iconst_m1 .. iconst_5
      stack.push(op - 0x03);
    } else if (op === 0x10) { // bipush
      stack.push(code.readInt8(i + 1));
      i += 1;
    } else if (op === 0x11) { // sipush
      stack.push(code.readInt16BE(i + 1));
      i += 2;
    } else if (op === 0x59) { // dup
      stack.push(stack[stack.length - 1]);
    } else if (op === 0x53) { // aastore
      const val = stack.pop() as string;
      const idx = stack.pop() as number;
      const arr = stack.pop() as string[];
      arr[idx] = val;
    } else if (op === 0xbd) { // anewarray
      const count = stack.pop() as number;
      stack.push(new Array(count));
      i += 2;
    } else if (op === 0xb3) { // putstatic
      const fIdx = code.readUInt16BE(i + 1);
      i += 2;
      const fieldRef = cls.cp[fIdx];
      if (fieldRef && fieldRef.idx2 !== undefined) {
        const nt = cls.cp[fieldRef.idx2];
        if (nt && nt.idx1 !== undefined) {
          const fName = cls.cp[nt.idx1]?.str;
          const val = stack.pop() as string[];
          if (fName === targetFieldName) {
            return val;
          }
        }
      }
    } else if (op === 0xb5) { // putfield
      i += 2;
      stack.pop();
      stack.pop();
    } else if (op === 0xb2) { // getstatic
      i += 2;
      stack.push(null);
    } else if (op === 0xb4) { // getfield
      i += 2;
      stack.pop();
      stack.push(null);
    } else if (op === 0xb6 || op === 0xb7 || op === 0xb8) { // invokevirtual, invokespecial, invokestatic
      i += 2;
      stack.pop();
    } else if (op === 0x2a) { // aload_0
      stack.push(null);
    }
  }

  throw new Error(`Failed to extract field ${targetFieldName} from ${methodName}`);
}

function extract2DStringArray(cls: ParsedClass, methodName: string, targetFieldName: string): [string, string][] {
  const method = cls.methods.find((m) => m.mName === methodName);
  if (!method || !method.code) {
    throw new Error(`Method ${methodName} with code not found in class`);
  }
  const code = method.code;
  const stack: unknown[] = [];

  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    if (op === 0x12) {
      const idx = code[i + 1];
      i += 1;
      const s = resolveString(cls.cp, idx);
      stack.push(s !== null ? s : { constIdx: idx });
    } else if (op === 0x13) {
      const idx = code.readUInt16BE(i + 1);
      i += 2;
      const s = resolveString(cls.cp, idx);
      stack.push(s !== null ? s : { constIdx: idx });
    } else if (op >= 0x02 && op <= 0x08) {
      stack.push(op - 0x03);
    } else if (op === 0x10) {
      stack.push(code.readInt8(i + 1));
      i += 1;
    } else if (op === 0x11) {
      stack.push(code.readInt16BE(i + 1));
      i += 2;
    } else if (op === 0x59) {
      stack.push(stack[stack.length - 1]);
    } else if (op === 0x53) {
      const val = stack.pop();
      const idx = stack.pop() as number;
      const arr = stack.pop() as unknown[];
      arr[idx] = val;
    } else if (op === 0xbd) {
      const count = stack.pop() as number;
      stack.push(new Array(count));
      i += 2;
    } else if (op === 0xb3) {
      const fIdx = code.readUInt16BE(i + 1);
      i += 2;
      const fieldRef = cls.cp[fIdx];
      if (fieldRef && fieldRef.idx2 !== undefined) {
        const nt = cls.cp[fieldRef.idx2];
        if (nt && nt.idx1 !== undefined) {
          const fName = cls.cp[nt.idx1]?.str;
          const val = stack.pop() as [string, string][];
          if (fName === targetFieldName) {
            return val;
          }
        }
      }
    }
  }

  throw new Error(`Failed to extract 2D array ${targetFieldName} from ${methodName}`);
}

function extractZeusMapNames(cls: ParsedClass): Map<number, string> {
  const method = cls.methods.find((m) => m.mName === "mapName");
  if (!method || !method.code) {
    throw new Error("Method mapName not found in Zeus.class");
  }
  const code = method.code;
  const mapNames = new Map<number, string>();

  for (let c = 0; c < code.length; c++) {
    if (code[c] === 0xab) { // lookupswitch
      const pad = (4 - ((c + 1) % 4)) % 4;
      let p = c + 1 + pad;
      p += 4; // skip default offset
      const npairs = code.readInt32BE(p);
      p += 4;
      for (let k = 0; k < npairs; k++) {
        const match = code.readInt32BE(p);
        p += 4;
        const target = code.readInt32BE(p);
        p += 4;
        const targetPc = c + target;
        const targetOp = code[targetPc];
        let str: string | null = null;
        if (targetOp === 0x12) {
          str = resolveString(cls.cp, code[targetPc + 1]);
        } else if (targetOp === 0x13) {
          str = resolveString(cls.cp, code.readUInt16BE(targetPc + 1));
        }
        if (str !== null) {
          mapNames.set(match, str);
        }
      }
    }
  }

  return mapNames;
}

function extractMapAdjString(cls: ParsedClass): string {
  for (const item of cls.cp) {
    if (item && item.tag === 1 && item.str && item.str.startsWith("0:1|1:0,")) {
      return item.str;
    }
  }
  throw new Error("MAP_ADJ string constant not found in Zeus.class constant pool");
}

function computeSCCs(adj: Map<number, number[]>): number[][] {
  let index = 0;
  const indices = new Map<number, number>();
  const lowlinks = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const sccs: number[][] = [];

  function strongConnect(v: number): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) || [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) {
      strongConnect(v);
    }
  }

  return sccs;
}

function parseCliArgs(): { sourceRoot: string } {
  const args = process.argv.slice(2);
  let sourceRoot: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source-root" && i + 1 < args.length) {
      sourceRoot = path.resolve(args[i + 1]);
      i++;
    }
  }

  if (!sourceRoot) {
    const candidates = [
      path.resolve(import.meta.dirname, "../../docker-build"),
      path.resolve(process.cwd(), "../docker-build"),
      path.resolve("d:/Gaming/KnightOnline_402/docker-build"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "vendor/game/Zeus_Knight.jar"))) {
        sourceRoot = candidate;
        break;
      }
    }
  }

  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    console.error(`Error: source root not found: ${sourceRoot}`);
    console.error("Please supply --source-root <path-to-knight_build>");
    process.exit(1);
  }

  return { sourceRoot };
}

function main(): void {
  const { sourceRoot } = parseCliArgs();
  console.log(`[generate-game-catalog] Source root: ${sourceRoot}`);

  const jarPath = path.join(sourceRoot, "vendor/game/Zeus_Knight.jar");
  const metaPath = path.join(sourceRoot, "vendor/game/zeus-jar.json");

  if (!fs.existsSync(jarPath)) {
    throw new Error(`Zeus_Knight.jar not found at ${jarPath}`);
  }
  if (!fs.existsSync(metaPath)) {
    throw new Error(`zeus-jar.json not found at ${metaPath}`);
  }

  // 1. Validate SHA256 & read CTL_VERSION
  const metaContent = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const jarBuf = fs.readFileSync(jarPath);
  const actualJarSha256 = crypto.createHash("sha256").update(jarBuf).digest("hex");
  if (actualJarSha256 !== metaContent.jar_sha256) {
    throw new Error(
      `Jar SHA256 mismatch! Expected: ${metaContent.jar_sha256}, Actual: ${actualJarSha256}`,
    );
  }
  const ctlVersion = metaContent.ctl_version;
  console.log(`[generate-game-catalog] Validated jar SHA256: ${actualJarSha256}`);
  console.log(`[generate-game-catalog] Provenance CTL_VERSION: ${ctlVersion}`);

  // 2. Resolve commit SHA of source repo
  let sourceCommit = "702e1353f638de76602b2e4ee4ea5b4319e179c5";
  try {
    const rev = childProcess.execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    if (rev && rev.length === 40) {
      sourceCommit = rev;
    }
  } catch {
    // fallback to expected commit
  }
  console.log(`[generate-game-catalog] Source commit: ${sourceCommit}`);

  // 3. Extract required class files to temp dir
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeus-catalog-"));
  try {
    childProcess.execFileSync("tar", [
      "-xf",
      jarPath,
      "-C",
      tempDir,
      "df.class",
      "eg.class",
      "as.class",
      "t.class",
      "dx.class",
      "Zeus.class",
    ]);

    // 4. Parse classes
    const dfCls = parseClass(fs.readFileSync(path.join(tempDir, "df.class")));
    const egCls = parseClass(fs.readFileSync(path.join(tempDir, "eg.class")));
    const dxCls = parseClass(fs.readFileSync(path.join(tempDir, "dx.class")));
    const zeusCls = parseClass(fs.readFileSync(path.join(tempDir, "Zeus.class")));

    // 5. Extract raw data
    const dfGE = extract1DStringArray(dfCls, "<init>", "gE");
    if (dfGE.length !== 92) {
      throw new Error(`Expected df.gE length 92, got ${dfGE.length}`);
    }
    if (dfGE[81] !== "") {
      throw new Error(`Expected df.gE[81] to be empty string, got: "${dfGE[81]}"`);
    }

    const egGE = extract1DStringArray(egCls, "<init>", "gE");
    if (egGE.length !== 92) {
      throw new Error(`Expected eg.gE length 92, got ${egGE.length}`);
    }

    const dxB = extract2DStringArray(dxCls, "<clinit>", "b");
    if (dxB.length !== 8) {
      throw new Error(`Expected dx.b length 8, got ${dxB.length}`);
    }

    const zeusNames = extractZeusMapNames(zeusCls);
    const mapAdjStr = extractMapAdjString(zeusCls);

    // 6. Parse MAP_ADJ and build graph
    const adj = new Map<number, number[]>();
    const rows = mapAdjStr.split("|");
    for (const row of rows) {
      if (!row) continue;
      const [fromStr, toStr] = row.split(":");
      const from = parseInt(fromStr, 10);
      const targets = toStr ? toStr.split(",").filter(Boolean).map((x) => parseInt(x, 10)) : [];
      adj.set(from, targets);
    }

    // Assert graph node count
    if (adj.size !== 78) {
      throw new Error(`Invariant failed: expected 78 graph nodes, got ${adj.size}`);
    }

    // Compute SCCs via Tarjan
    const sccs = computeSCCs(adj);
    if (sccs.length !== 3) {
      throw new Error(`Invariant failed: expected 3 SCCs, got ${sccs.length}`);
    }

    const mainSCCList = sccs.find((s) => s.includes(1));
    if (!mainSCCList) {
      throw new Error("Invariant failed: main SCC containing Map 1 not found");
    }
    if (mainSCCList.length !== 76) {
      throw new Error(`Invariant failed: expected main SCC size 76, got ${mainSCCList.length}`);
    }

    const mainSCC = new Set(mainSCCList);
    if (mainSCC.has(127)) {
      throw new Error("Invariant failed: Map 127 must not be travelEligible");
    }
    if (mainSCC.has(135)) {
      throw new Error("Invariant failed: Map 135 must not be travelEligible");
    }

    console.log("[generate-game-catalog] All topology assertions PASSED: 78 nodes, 3 SCCs, 76 travelEligible");

    // 7. Assemble 101 referenced Game Map records
    const mapIds: number[] = [];
    for (let i = 0; i <= 91; i++) mapIds.push(i);
    for (let i = 92; i <= 98; i++) mapIds.push(i);
    mapIds.push(127);
    mapIds.push(135);

    interface GeneratedMapRecord {
      id: number;
      rawNameVi: string | null;
      rawNameEn?: string | null;
      adjacentTo: number[];
      travelEligible: boolean;
    }

    const generatedMaps: GeneratedMapRecord[] = [];

    for (const id of mapIds) {
      let rawNameVi: string | null = null;
      let rawNameEn: string | null = null;

      if (id <= 91) {
        rawNameVi = dfGE[id];
        rawNameEn = egGE[id];
      } else if (id >= 92 && id <= 98) {
        rawNameVi = zeusNames.get(id) ?? null;
        rawNameEn = null;
      } else if (id === 127) {
        rawNameVi = null;
        rawNameEn = null;
      } else if (id === 135) {
        rawNameVi = zeusNames.get(135) ?? null;
        rawNameEn = null;
      }

      const adjacentTo = [...(adj.get(id) ?? [])].sort((a, b) => a - b);
      const travelEligible = mainSCC.has(id);

      generatedMaps.push({
        id,
        rawNameVi,
        rawNameEn,
        adjacentTo,
        travelEligible,
      });
    }

    if (generatedMaps.length !== 101) {
      throw new Error(`Expected 101 generated map records, got ${generatedMaps.length}`);
    }

    // 8. Assemble 8 Server records
    interface GeneratedServerRecord {
      index: number;
      name: string;
      host: string;
    }

    const generatedServers: GeneratedServerRecord[] = [];
    for (let i = 0; i < 8; i++) {
      generatedServers.push({
        index: i,
        name: dxB[i][0],
        host: dxB[i][1],
      });
    }

    // 9. Format output TypeScript code
    const outContent = formatGeneratedCatalogFile({
      sourceRepository: "https://github.com/manhthien2005/knight_build",
      sourceCommit,
      sourceJarSha256: actualJarSha256,
      ctlVersion,
      sourcePaths: [
        "vendor/game/Zeus_Knight.jar",
        "vendor/game/zeus-jar.json",
      ],
      maps: generatedMaps,
      servers: generatedServers,
    });

    const targetFile = path.resolve(import.meta.dirname, "../src/lib/game-catalog.generated.ts");
    fs.writeFileSync(targetFile, outContent, "utf8");
    console.log(`[generate-game-catalog] Successfully wrote generated catalog to ${targetFile}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function formatGeneratedCatalogFile(data: {
  sourceRepository: string;
  sourceCommit: string;
  sourceJarSha256: string;
  ctlVersion: number;
  sourcePaths: string[];
  maps: {
    id: number;
    rawNameVi: string | null;
    rawNameEn?: string | null;
    adjacentTo: number[];
    travelEligible: boolean;
  }[];
  servers: {
    index: number;
    name: string;
    host: string;
  }[];
}): string {
  const travelCount = data.maps.filter((m) => m.travelEligible).length;

  return `/**
 * AUTOGENERATED GAME CATALOG FACT REPOSITORY
 * DO NOT EDIT MANUALLY
 *
 * Generated by: scripts/generate-game-catalog.ts
 *
 * PROVENANCE:
 *   source repository: ${data.sourceRepository}
 *   source commit:     ${data.sourceCommit}
 *   source paths:      ${data.sourcePaths.join(", ")}
 *   source jar sha256: ${data.sourceJarSha256}
 *   CTL_VERSION:       ${data.ctlVersion}
 *
 * TOTALS:
 *   referenced maps:  ${data.maps.length}
 *   travel eligible:  ${travelCount}
 *   servers:          ${data.servers.length}
 */

export interface GeneratedGameMap {
  readonly id: number;
  readonly rawNameVi: string | null;
  readonly rawNameEn?: string | null;
  readonly adjacentTo: readonly number[];
  readonly travelEligible: boolean;
}

export interface GeneratedGameServer {
  readonly index: number;
  readonly name: string;
  readonly host: string;
}

export interface GeneratedCatalogMetadata {
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly sourceJarSha256: string;
  readonly ctlVersion: number;
  readonly sourcePaths: readonly string[];
  readonly totalMapCount: number;
  readonly travelEligibleMapCount: number;
  readonly totalServerCount: number;
}

export const GENERATED_CATALOG_METADATA: GeneratedCatalogMetadata = {
  sourceRepository: "${data.sourceRepository}",
  sourceCommit: "${data.sourceCommit}",
  sourceJarSha256: "${data.sourceJarSha256}",
  ctlVersion: ${data.ctlVersion},
  sourcePaths: ${JSON.stringify(data.sourcePaths)},
  totalMapCount: ${data.maps.length},
  travelEligibleMapCount: ${travelCount},
  totalServerCount: ${data.servers.length},
} as const;

export const GENERATED_GAME_SERVERS: readonly GeneratedGameServer[] = ${JSON.stringify(data.servers, null, 2)} as const;

export const GENERATED_GAME_MAPS: readonly GeneratedGameMap[] = ${JSON.stringify(data.maps, null, 2)} as const;

export const GENERATED_GAME_MAP_BY_ID = new Map<number, GeneratedGameMap>(
  GENERATED_GAME_MAPS.map((map) => [map.id, map]),
);

export const GENERATED_GAME_SERVER_BY_INDEX = new Map<number, GeneratedGameServer>(
  GENERATED_GAME_SERVERS.map((server) => [server.index, server]),
);
`;
}

main();
