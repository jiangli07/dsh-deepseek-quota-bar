// pricing.js weekend rule tests (real import)
import { priceAt, isWeekend, isPeak } from '../lib/pricing.js';

const bj = (y, m, d, h) => new Date(Date.UTC(y, m - 1, d, h - 8)); // 北京 h 点 → UTC
const cases = [
  // [label, time, expect mode]
  ['2026-08-22 周六 10:00（8/23 政策前：周末仍分峰谷）', bj(2026, 8, 22, 10), 'peak'],
  ['2026-08-22 周六 20:00（8/23 政策前：周末低谷时段）', bj(2026, 8, 22, 20), 'offPeak'],
  ['2026-08-23 周日 10:00（新政策：周末全天低谷）', bj(2026, 8, 23, 10), 'offPeak'],
  ['2026-08-23 周日 20:00（新政策：周末全天低谷）', bj(2026, 8, 23, 20), 'offPeak'],
  ['2026-08-24 周一 10:00（工作日高峰）', bj(2026, 8, 24, 10), 'peak'],
  ['2026-08-24 周一 13:00（工作日低谷）', bj(2026, 8, 24, 13), 'offPeak'],
  ['2026-08-29 周六 11:00（新政策周末）', bj(2026, 8, 29, 11), 'offPeak'],
];
let ok = true;
for (const [label, time, expected] of cases) {
  const r = priceAt('deepseek-v4-flash', time.getTime());
  const pass = r.mode === expected;
  if (!pass) { ok = false; console.log('FAIL:', label, 'got', r.mode, 'exp', expected); }
  else console.log('ok  :', label, '→', r.mode);
}
// isWeekend sanity
if (!isWeekend(bj(2026, 8, 22, 10).getTime())) { ok = false; console.log('FAIL isWeekend 周六'); }
if (isWeekend(bj(2026, 8, 24, 10).getTime())) { ok = false; console.log('FAIL isWeekend 周一'); }
console.log(ok ? 'ALL PRICING WEEKEND TESTS PASSED' : 'TESTS FAILED');
