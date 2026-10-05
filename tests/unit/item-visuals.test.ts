import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !specifier.endsWith(".ts")) {
      try {
        return await nextResolve(specifier + ".ts", context);
      } catch (_) {}
    }
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(hookCode), import.meta.url);

const { cleanItemName, getItemLevelColor, getTierInfo } = await import("../../src/lib/item-visuals");

describe("item-visuals UI formatting helpers", () => {
  it("cleanItemName removes [Khoá] and [Khóa] cleanly", () => {
    assert.equal(cleanItemName("Áo giáp tử thần [Khoá]"), "Áo giáp tử thần");
    assert.equal(cleanItemName("Nhẫn lãng quên [Khóa] +1"), "Nhẫn lãng quên +1");
    assert.equal(cleanItemName("Kiếm nhân mã"), "Kiếm nhân mã");
    assert.equal(cleanItemName(""), "");
  });

  it("getItemLevelColor correctly categorizes levels 0-3, 4-6, 7-9, 10-15", () => {
    // 0-3: Trắng
    assert.ok(getItemLevelColor(0).badge.includes("slate-100"));
    assert.ok(getItemLevelColor(1).badge.includes("slate-100"));
    assert.ok(getItemLevelColor(3).badge.includes("slate-100"));

    // 4-6: Vàng
    assert.ok(getItemLevelColor(4).badge.includes("amber"));
    assert.ok(getItemLevelColor(5).badge.includes("amber"));
    assert.ok(getItemLevelColor(6).badge.includes("amber"));

    // 7-9: Tím
    assert.ok(getItemLevelColor(7).badge.includes("purple"));
    assert.ok(getItemLevelColor(8).badge.includes("purple"));
    assert.ok(getItemLevelColor(9).badge.includes("purple"));

    // 10-15: Cam
    assert.ok(getItemLevelColor(10).badge.includes("orange"));
    assert.ok(getItemLevelColor(12).badge.includes("orange"));
    assert.ok(getItemLevelColor(15).badge.includes("orange"));
  });

  it("getTierInfo correctly maps tiers to Xanh, Tím, Cam without 'Tier' label", () => {
    assert.equal(getTierInfo(0), null);

    const tier1 = getTierInfo(1);
    assert.equal(tier1?.label, "Xanh");
    assert.ok(tier1?.colorClass.includes("sky"));

    const tier2 = getTierInfo(2);
    assert.equal(tier2?.label, "Xanh");

    const tier3 = getTierInfo(3);
    assert.equal(tier3?.label, "Tím");
    assert.ok(tier3?.colorClass.includes("purple"));

    const tier4 = getTierInfo(4);
    assert.equal(tier4?.label, "Cam");
    assert.ok(tier4?.colorClass.includes("orange"));

    const tier5 = getTierInfo(5);
    assert.equal(tier5?.label, "Cam");
  });
});
