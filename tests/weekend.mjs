// Mirror tests for client.js weekend-aware isPeakNow / nextTransition
const PEAK_WINDOWS = [[9, 12], [14, 18]];
const bj = (y, m, d, h, min) => new Date(Date.UTC(y, m - 1, d, h - 8, min)); // 北京时刻 → UTC

function beijingWeekday(date) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? date.getDay();
}
function beijingMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour12: false, hour: 'numeric', minute: 'numeric' }).formatToParts(date);
  return (Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}
function isPeakNow(date) {
  const weekday = beijingWeekday(date);
  if (weekday === 0 || weekday === 6) return false;
  const minutes = beijingMinutes(date);
  return PEAK_WINDOWS.some(([start, end]) => minutes >= start * 60 && minutes < end * 60);
}
function nextTransition(date) {
  const weekday = beijingWeekday(date);
  const current = beijingMinutes(date);
  if (weekday === 0 || weekday === 6) {
    const fullDays = weekday === 0 ? 0 : 1;
    return { toPeak: true, minutes: fullDays * 24 * 60 + (24 * 60 - current) + 9 * 60 };
  }
  const boundaries = [
    { at: 9 * 60, toPeak: true },
    { at: 12 * 60, toPeak: false },
    { at: 14 * 60, toPeak: true },
    { at: 18 * 60, toPeak: false },
  ];
  for (const b of boundaries) if (b.at > current) return { toPeak: b.toPeak, minutes: b.at - current };
  const tomorrow = weekday === 5 ? 6 : weekday + 1;
  if (tomorrow === 6) return { toPeak: true, minutes: (24 * 60 - current) + 2 * 24 * 60 + 9 * 60 };
  return { toPeak: true, minutes: (24 * 60 - current) + 9 * 60 };
}

// 2026-08-22 周六 / 08-23 周日 / 08-24 周一（真实日历验证）
let ok = true;
const check = (label, got, exp) => {
  const pass = JSON.stringify(got) === JSON.stringify(exp);
  if (!pass) { ok = false; console.log('FAIL:', label, 'got', JSON.stringify(got), 'exp', JSON.stringify(exp)); }
  else console.log('ok  :', label, JSON.stringify(got));
};

check('周六 10:00 非高峰', isPeakNow(bj(2026, 8, 22, 10, 0)), false);
check('周日 10:00 非高峰', isPeakNow(bj(2026, 8, 23, 10, 0)), false);
check('周一 10:00 高峰', isPeakNow(bj(2026, 8, 24, 10, 0)), true);
check('周五 17:00 高峰', isPeakNow(bj(2026, 8, 21, 17, 0)), true);

// 周六 10:00 → 周一 09:00 高峰 = 周六剩 14h + 周日 24h + 周一 9h = 47h = 2820min
check('周六 10:00 → 周一09:00 高峰', nextTransition(bj(2026, 8, 22, 10, 0)), { toPeak: true, minutes: 2820 });
// 周日 20:00 → 周一 09:00 = 4h + 9h = 13h = 780min
check('周日 20:00 → 周一09:00 高峰', nextTransition(bj(2026, 8, 23, 20, 0)), { toPeak: true, minutes: 780 });
// 周一 10:00（高峰）→ 12:00 低谷 = 120min
check('周一 10:00 → 12:00 低谷', nextTransition(bj(2026, 8, 24, 10, 0)), { toPeak: false, minutes: 120 });
// 周一 13:00（低谷）→ 14:00 高峰 = 60min
check('周一 13:00 → 14:00 高峰', nextTransition(bj(2026, 8, 24, 13, 0)), { toPeak: true, minutes: 60 });
// 周五 19:00 → 周一 09:00 = 5h + 48h + 9h = 62h = 3720min
check('周五 19:00 → 周一09:00 高峰', nextTransition(bj(2026, 8, 21, 19, 0)), { toPeak: true, minutes: 3720 });
// 周一 19:00 → 周二 09:00 = 5h + 9h = 14h = 840min
check('周一 19:00 → 周二09:00 高峰', nextTransition(bj(2026, 8, 24, 19, 0)), { toPeak: true, minutes: 840 });

console.log(ok ? 'ALL CLIENT WEEKEND TESTS PASSED' : 'TESTS FAILED');
