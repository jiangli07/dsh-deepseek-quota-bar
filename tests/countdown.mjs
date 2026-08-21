// Countdown format test (mirrors client.js rendering)
const cases = [
  [150, '2h30m 后转低谷'],
  [90, '1h30m 后转低谷'],
  [900, '15h00m 后转高峰'],
  [1, '0h01m 后转低谷'],
  [119, '1h59m 后转低谷'],
];
const fmt = (t) => `${Math.floor(t.minutes / 60)}h${String(t.minutes % 60).padStart(2, '0')}m 后转${t.toPeak ? '高峰' : '低谷'}`;
let ok = true;
for (const [m, exp] of cases) {
  const got = fmt({ toPeak: m >= 540, minutes: m });
  if (got !== exp) { ok = false; console.log('FAIL', m, 'got:', got, 'exp:', exp); }
}
console.log(ok ? 'COUNTDOWN FORMAT OK' : 'FAILED');
