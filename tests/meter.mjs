// Mirror test of the meter algorithm in lib/index.js (computeConsumed).
// Verifies: fresh-month seed, day rollover, same-day accumulation, top-up floor.
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- mirrored logic (kept in sync with lib/index.js) ---------------------
function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadMeterState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" &&
        typeof parsed.month === "string" && typeof parsed.monthOpening === "number" &&
        typeof parsed.day === "string" && typeof parsed.dayOpening === "number" &&
        typeof parsed.last === "number") return parsed;
  } catch {}
  return null;
}

function saveMeterState(path, state) {
  writeFileSync(path, JSON.stringify(state), "utf8");
}

function computeConsumed(path, balance, now = new Date()) {
  if (!Number.isFinite(balance)) return null;
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today = localDate(now);
  const stored = loadMeterState(path);
  const freshMonth = stored === null || stored.month !== monthKey;
  const freshDay = !freshMonth && stored.day !== today;
  const monthOpening = freshMonth ? balance : stored.monthOpening;
  const dayOpening = freshMonth ? balance : freshDay ? (Number.isFinite(stored.last) ? stored.last : balance) : stored.dayOpening;
  saveMeterState(path, { month: monthKey, monthOpening, day: today, dayOpening, last: balance });
  return {
    today: Math.max(0, Math.round((dayOpening - balance) * 100) / 100),
    month: Math.max(0, Math.round((monthOpening - balance) * 100) / 100),
    monthOpening: Math.round(monthOpening * 100) / 100
  };
}

// ---- scenario helpers -----------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "meter-test-"));
const statePath = join(dir, "state.json");

// 1. Fresh install: balance 50 -> seeds month & day at 50, zero consumption.
let r = computeConsumed(statePath, 50, new Date(2026, 7, 15, 9, 0));
assert.deepStrictEqual(r, { today: 0, month: 0, monthOpening: 50 });
console.log("1 fresh-install seed OK:", JSON.stringify(r));

// 2. Same day spend: 50 -> 47.35.
r = computeConsumed(statePath, 47.35, new Date(2026, 7, 15, 10, 0));
assert.deepStrictEqual(r, { today: 2.65, month: 2.65, monthOpening: 50 });
console.log("2 same-day spend OK:", JSON.stringify(r));

// 3. Next day: dayOpening = yesterday's last (47.35); month opening stays 50.
r = computeConsumed(statePath, 45, new Date(2026, 7, 16, 8, 0));
assert.deepStrictEqual(r, { today: 2.35, month: 5, monthOpening: 50 });
console.log("3 next-day rollover OK:", JSON.stringify(r));

// 4. Top-up mid-month: balance 60 (was 45) -> consumption floored at 0.
r = computeConsumed(statePath, 60, new Date(2026, 7, 16, 9, 0));
assert.deepStrictEqual(r, { today: 0, month: 0, monthOpening: 50 });
console.log("4 top-up floor OK:", JSON.stringify(r));

// 5. Next month: fresh month seeds at current balance 58.
r = computeConsumed(statePath, 58, new Date(2026, 8, 1, 0, 5));
assert.deepStrictEqual(r, { today: 0, month: 0, monthOpening: 58 });
console.log("5 month rollover OK:", JSON.stringify(r));

// 6. NaN balance rejected.
r = computeConsumed(statePath, NaN, new Date(2026, 8, 1, 0, 6));
assert.strictEqual(r, null);
console.log("6 NaN guard OK");

console.log("\nALL METER TESTS PASSED");
