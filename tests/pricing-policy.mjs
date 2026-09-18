// pricing.js policy-chain tests: 2026-09-10 12:00 flash price cut + pro unchanged
import { priceAt } from '../lib/pricing.js';

const bj = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 8, min));
let ok = true;
const check = (label, time, model, expCny, expMode) => {
  const r = priceAt(model, time.getTime());
  const got = r.cny;
  const pass = got.input === expCny.input && got.cacheRead === expCny.cacheRead && got.output === expCny.output && r.mode === expMode;
  if (!pass) { ok = false; console.log('FAIL:', label, 'got', JSON.stringify(got), r.mode, 'exp', JSON.stringify(expCny), expMode); }
  else console.log('ok  :', label, `${got.input}/${got.cacheRead}/${got.output}`, r.mode);
};

// 旧价（8/17 政策）
check('9/9 工作日高峰 flash 旧价', bj(2026, 9, 9, 10), 'deepseek-v4-flash', { input: 3, cacheRead: 0.1, output: 9 }, 'peak');
check('9/10 11:59 工作日高峰 flash 旧价（生效前）', bj(2026, 9, 10, 11, 59), 'deepseek-v4-flash', { input: 3, cacheRead: 0.1, output: 9 }, 'peak');
// 新价（9/10 12:00 生效；注意 12:00 是高峰窗口 [9,12) 的结束边界，本身即低谷）
check('9/10 12:00 工作日低谷 flash 新价（生效瞬间）', bj(2026, 9, 10, 12), 'deepseek-v4-flash', { input: 1, cacheRead: 0.02, output: 4 }, 'offPeak');
check('9/10 14:00 工作日高峰 flash 新价', bj(2026, 9, 10, 14), 'deepseek-v4-flash', { input: 2, cacheRead: 0.04, output: 8 }, 'peak');
check('9/11 工作日高峰 flash 新价', bj(2026, 9, 11, 10), 'deepseek-v4-flash', { input: 2, cacheRead: 0.04, output: 8 }, 'peak');
check('9/11 工作日低谷 flash 新价', bj(2026, 9, 11, 20), 'deepseek-v4-flash', { input: 1, cacheRead: 0.02, output: 4 }, 'offPeak');
check('9/12 周六全天低谷 flash 新价', bj(2026, 9, 12, 10), 'deepseek-v4-flash', { input: 1, cacheRead: 0.02, output: 4 }, 'offPeak');
// Pro 不受 9/10 政策影响
check('9/11 工作日高峰 pro 价格不变', bj(2026, 9, 11, 10), 'deepseek-v4-pro', { input: 9, cacheRead: 0.3, output: 27 }, 'peak');
check('9/11 工作日低谷 pro 价格不变', bj(2026, 9, 11, 20), 'deepseek-v4-pro', { input: 4.5, cacheRead: 0.15, output: 13.5 }, 'offPeak');
// 历史（8/17 政策）不受新政策影响
check('8/24 工作日高峰 flash 历史价', bj(2026, 8, 24, 10), 'deepseek-v4-flash', { input: 3, cacheRead: 0.1, output: 9 }, 'peak');
// vision-exp 与 flash 同价
check('9/11 工作日低谷 flash-vision-exp 新价', bj(2026, 9, 11, 20), 'deepseek-v4-flash-vision-exp', { input: 1, cacheRead: 0.02, output: 4 }, 'offPeak');
// usd 档位也应有值
const usd = priceAt('deepseek-v4-flash', bj(2026, 9, 11, 20).getTime()).usd;
if (usd.input !== 0.14 || usd.cacheRead !== 0.0028 || usd.output !== 0.56) { ok = false; console.log('FAIL usd:', JSON.stringify(usd)); }
else console.log('ok  : usd 档位', JSON.stringify(usd));

console.log(ok ? 'ALL PRICING POLICY TESTS PASSED' : 'TESTS FAILED');
