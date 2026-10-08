/**
 * dsh-deepseek-quota — host half.
 *
 * Registers one exact HTTP route on the dsh web server:
 *
 *   GET /api/deepseek-balance
 *
 * which resolves the DeepSeek API key through the credentials seam
 * (the same `DEEPSEEK_API_KEY` reference the llm-deepseek adapter uses),
 * calls DeepSeek's public `/user/balance` endpoint, and returns:
 *
 *   {
 *     "ok": true,
 *     "balance": <provider payload>,
 *     "todayConsumed": <number|null>,
 *     "todayConsumedSource": "official" | "estimate"
 *   }
 *
 * `todayConsumed` — the widget's "今日已消费" value — comes from one of two
 * sources:
 *
 * 1. **Official (preferred)**: when the optional `DEEPSEEK_PLATFORM_TOKEN`
 *    credential is configured, the host queries DeepSeek's dashboard usage
 *    API (`platform.deepseek.com/api/v0/usage/cost?month=&year=` — the same
 *    date-filterable data the platform web console shows) and picks today's
 *    row. Source is reported as `"official"`.
 * 2. **Estimate (fallback)**: without the platform token, the host meters the
 *    balance: it persists the first (day-opening) balance of the local
 *    calendar day under `$DSH_HOME/storages/deepseek-quota-day.json` and
 *    reports `max(0, opening − current)`. Source is `"estimate"`, and the
 *    widget prefixes the value with "≈".
 *
 * Provider errors and local failures return a small `{ ok, error, message }`
 * envelope the browser widget renders. The API key never leaves the host: the
 * browser only ever talks to this route, and keys are resolved per request
 * through `ctx.credentials`.
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { costOf, priceAt } from "./pricing.js";

const name = "dsh-deepseek-quota";
const inject = ["credentials", "webServer"];

const PUBLIC_BASE_URL = "https://api.deepseek.com";
/** Environment override honored for parity with the llm-deepseek adapter. */
const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
// Credential refs are validated environment-variable names.  Keep these as
// plain strings so a profile-linked plugin does not need to resolve an
// internal Harness package from outside the profile's node_modules tree.
const CREDENTIAL_REF = "DEEPSEEK_API_KEY";
/** Optional platform session token (localStorage `userToken` of platform.deepseek.com). */
const PLATFORM_TOKEN_REF = "DEEPSEEK_PLATFORM_TOKEN";
const BALANCE_PATH = "/user/balance";
const ROUTE_PATH = "/api/deepseek-balance";
const SESSION_COST_ROUTE_PATH = "/api/deepseek-session-cost";
const TIMEOUT_MS = 15000;
/** Monthly+day meter state file name inside `$DSH_HOME/storages` (blood-bar denominator = month opening). */
const BAR_STATE_FILE = "deepseek-quota-bar.json";
/** Platform usage (cost) endpoint: per-day cost for one month, filterable by date. */
const PLATFORM_USAGE_URL = "https://platform.deepseek.com/api/v0/usage/cost";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function balanceUrl() {
  const base = process.env[BASE_URL_ENV] ?? PUBLIC_BASE_URL;
  return `${base.replace(/\/+$/, "")}${BALANCE_PATH}`;
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

/** Extract a readable provider message from a DeepSeek error body. */
function providerMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {}
  return `DeepSeek 接口返回 HTTP ${status}`;
}

// ---- daily consumption: official platform source -------------------------

/** Local calendar day as `YYYY-MM-DD` (dashboard rows are keyed by date). */
function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Coerce a possibly-string number to a finite number, or NaN. */
function toFinite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Fetch official cost rows for the current month from the DeepSeek platform
 * dashboard API. Response envelope: `{ code: 0, data: { biz_code: 0,
 * biz_data: { days: [ { date: "YYYY-MM-DD", data: [ { usage: [
 * { cost|amount, ... } ] } ] } ] } } }`. Parsing is defensive against renamed
 * fields.
 * @returns `{ today, month }` (today's row sum and the whole month's sum) in
 * the account currency, or `null` when the shape differs.
 * @throws on transport errors, non-zero envelope codes, and HTTP failures.
 */
async function fetchPlatformUsage(token) {
  const now = new Date();
  const url = `${PLATFORM_USAGE_URL}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "x-app-version": "1.0.0",
      Origin: "https://platform.deepseek.com",
      Referer: "https://platform.deepseek.com/usage"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`DeepSeek 平台用量接口返回 HTTP ${response.status}`);
  const body = await response.json();
  const biz = body && typeof body === "object" ? body.data : void 0;
  if (body?.code !== 0 || biz === void 0 || biz.biz_code !== 0) {
    const code = body?.code ?? biz?.biz_code;
    if (code === 40002 || code === 40003) {
      throw new Error("DEEPSEEK_PLATFORM_TOKEN 已过期：请重新登录 platform.deepseek.com 并更新 userToken");
    }
    throw new Error(`DeepSeek 平台用量接口错误 (code ${code ?? "unknown"})`);
  }
  const bizData = biz.biz_data;
  const container = Array.isArray(bizData) ? bizData[0] : bizData;
  const days = container && typeof container === "object" ? container.days : void 0;
  if (!Array.isArray(days)) return null;
  const today = localDate();
  let monthTotal = 0;
  let todayTotal = 0;
  for (const day of days) {
    if (!day || typeof day !== "object" || !Array.isArray(day.data)) continue;
    let daySum = 0;
    for (const modelEntry of day.data) {
      if (!modelEntry || typeof modelEntry !== "object" || !Array.isArray(modelEntry.usage)) continue;
      for (const u of modelEntry.usage) {
        if (!u || typeof u !== "object") continue;
        const value = toFinite(u.cost ?? u.amount);
        if (Number.isFinite(value)) daySum += value;
      }
    }
    monthTotal += daySum;
    if (day.date === today) todayTotal = daySum;
  }
  return { today: Math.round(todayTotal * 100) / 100, month: Math.round(monthTotal * 100) / 100 };
}

// ---- consumption estimate: balance-delta meter (day + month) -------------

/**
 * Absolute path of the meter state file. Prefers the harness-provided
 * `dshHomePath` service, then `$DSH_HOME`, then the default home.
 */
function meterStatePath(ctx) {
  let storages;
  const homeFn = typeof ctx.get === "function" ? ctx.get("dshHomePath") : void 0;
  if (typeof homeFn === "function") {
    storages = homeFn("storages");
  } else if (process.env.DSH_HOME) {
    storages = join(process.env.DSH_HOME, "storages");
  } else {
    storages = join(homedir(), ".dsh", "storages");
  }
  return join(storages, BAR_STATE_FILE);
}

/**
 * Read the persisted meter state; `null` when absent or malformed. Shape:
 * `{ month: "YYYY-MM", monthOpening, day: "YYYY-MM-DD", dayOpening, last }`.
 */
function loadMeterState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.month === "string" &&
      typeof parsed.monthOpening === "number" &&
      typeof parsed.day === "string" &&
      typeof parsed.dayOpening === "number" &&
      typeof parsed.last === "number"
    ) {
      return parsed;
    }
  } catch {}
  return null;
}

/** Persist the meter state (best-effort; a failure just resets the meter). */
function saveMeterState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, path);
  } catch {}
}

/**
 * Advance the day+month meter with one observed balance and return the
 * consumption estimates `{ today, month }` (`max(0, opening − balance)`,
 * rounded to cents), or `null` when the balance is unusable.
 *
 * - Month opening (the blood-bar denominator): the first balance observed in
 *   the current local month — i.e. the balance at month start as seen by the
 *   meter; a fresh month (or a fresh install) seeds it with the current
 *   balance.
 * - Day opening: the first balance observed in the current local day (falls
 *   back to the last balance of the previous day, or the current balance).
 *
 * The estimate is only as good as the balance series: a top-up during the
 * period lowers the apparent consumption (floor at 0).
 */
function computeConsumed(ctx, balance) {
  if (!Number.isFinite(balance)) return null;
  const path = meterStatePath(ctx);
  const now = new Date();
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

// ---- plugin body ---------------------------------------------------------

/** Round a cost to 6 decimals for the wire (costs can be fractions of a cent). */
function roundCost(value) {
  return Math.round(value * 1e6) / 1e6;
}

/** Empty per-session cost record (flat sums + per-bucket token/cost pairs for the formula breakdown). */
function emptyCostRecord() {
  return {
    calls: 0,
    cost: 0,
    costUsd: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    buckets: {
      input: { tokens: 0, cost: 0 },
      cacheRead: { tokens: 0, cost: 0 },
      output: { tokens: 0, cost: 0 }
    }
  };
}

/** Price one `assistant/message` event into a cost record (shared by live and replay paths). */
function priceEventInto(record, event) {
  const data = event.data;
  const usage = data?.usage;
  if (usage === void 0 || usage === null) return false;
  if (typeof usage.outputTokens !== "number" && typeof usage.inputTokens !== "number") return false;
  const source = data.message?.source;
  const model = typeof source?.model === "string" ? source.model : "unknown";
  const unit = priceAt(model, event.time ?? Date.now());
  const sample = costOf(usage, unit);
  record.calls += 1;
  record.cost += sample.cost;
  record.costUsd += sample.costUsd;
  record.inputTokens += sample.inputTokens;
  record.cacheReadTokens += sample.cacheReadTokens;
  record.outputTokens += sample.outputTokens;
  // 分桶累计（按每条消息的实际单价），供"计算公式"明细展示。
  record.buckets.input.tokens += sample.inputTokens;
  record.buckets.input.cost += (sample.inputTokens * unit.cny.input) / 1e6;
  record.buckets.cacheRead.tokens += sample.cacheReadTokens;
  record.buckets.cacheRead.cost += (sample.cacheReadTokens * unit.cny.cacheRead) / 1e6;
  record.buckets.output.tokens += sample.outputTokens;
  record.buckets.output.cost += (sample.outputTokens * unit.cny.output) / 1e6;
  return true;
}

/**
 * Build the formula breakdown for one cost record: per bucket `{ label, tokens,
 * rate, subtotal }`, where `rate` is the EFFECTIVE blended price (¥/M) — the
 * exact `subtotal / tokens × 1e6` so `tokens × rate = subtotal` holds for the
 * displayed formula. Zero-token buckets are kept with rate 0.
 */
function breakdownOf(record) {
  const parts = [
    { label: "输入(未命中)", key: "input" },
    { label: "缓存命中", key: "cacheRead" },
    { label: "输出", key: "output" }
  ];
  return parts.map(({ label, key }) => {
    const bucket = record.buckets[key];
    const tokens = bucket.tokens;
    const subtotal = bucket.cost;
    const rate = tokens > 0 ? roundCost((subtotal / tokens) * 1e6) : 0;
    return { label, tokens, rate, subtotal: roundCost(subtotal) };
  });
}

/** Min interval between log re-decodings of the same session (avoids churn during active turns). */
const REPLAY_MIN_INTERVAL_MS = 2000;

/** Price every `assistant/message` of one decoded event list into a fresh record. */
function priceEvents(events) {
  const record = emptyCostRecord();
  for (const event of events) {
    if (event === null || typeof event !== "object" || event.type !== "assistant/message") continue;
    try {
      priceEventInto(record, event);
    } catch {
      // one malformed message must not fail the whole replay
    }
  }
  return record;
}

/**
 * Resolve the stored-log seam the running dsh exposes:
 *
 * 1. **dsh < 0.2**: `readStoredRevision(id)` for the change token plus
 *    `readRaw(id)`, which returns the JSONL text of the log.
 * 2. **dsh >= 0.2**: `stat(id)` for the change token plus a read handle from
 *    `open(id, "read")`, whose `read()` returns the decoded event list.
 *
 * @param persistence - the `sessionPersistence` service.
 * @param sessionId - session to read.
 * @returns `{ revision, read }`, where `read()` prices the whole stored log, or
 * `null` when the session has no stored log or neither seam is available.
 */
async function storedLogSeam(persistence, sessionId) {
  if (typeof persistence.readStoredRevision === "function" && typeof persistence.readRaw === "function") {
    const revision = await persistence.readStoredRevision(sessionId);
    if (revision === void 0) return null;
    return {
      revision,
      read: async () => {
        const raw = await persistence.readRaw(sessionId);
        if (raw === void 0 || raw === null || typeof raw.content !== "string") return null;
        const events = [];
        for (const line of raw.content.split("\n")) {
          if (line === "") continue;
          try {
            events.push(JSON.parse(line));
          } catch {
            // one torn line must not fail the whole replay
          }
        }
        return priceEvents(events);
      }
    };
  }
  if (typeof persistence.stat !== "function" || typeof persistence.open !== "function") return null;
  const snapshot = await persistence.stat(sessionId);
  if (snapshot === void 0 || snapshot === null || snapshot.revision === void 0) return null;
  return {
    revision: snapshot.revision,
    read: async () => {
      const handle = await persistence.open(sessionId, "read");
      try {
        const result = await handle.read(0);
        return priceEvents(Array.isArray(result?.events) ? result.events : []);
      } finally {
        await handle.close();
      }
    }
  };
}

/**
 * Replay a session's persisted log and price EVERY assistant/message event, so
 * the reported cost covers the whole conversation (including messages that
 * happened before this plugin loaded — the live in-memory ledger alone would
 * undercount after a restart). Cached per session by the stored log's change
 * token (`stat`, or `readStoredRevision` on dsh < 0.2), with a short minimum
 * re-decode interval.
 *
 * @param ctx - plugin context (reads `sessionPersistence`).
 * @param sessionId - session to price.
 * @returns the cost record plus the revision, or `null` when the session has
 * no stored log or the persistence seam is unavailable.
 */
async function replaySessionCost(ctx, sessionId) {
  const persistence = ctx.get("sessionPersistence");
  if (persistence === void 0) return null;
  let seam;
  try {
    seam = await storedLogSeam(persistence, sessionId);
  } catch (error) {
    ctx.logger.warn("dsh-deepseek-quota: failed to read session log revision");
    ctx.logger.warn(error);
    return null;
  }
  if (seam === null) return null;
  const cached = logCostCache.get(sessionId);
  if (cached !== void 0) {
    if (cached.revision === seam.revision) return cached;
    if (Date.now() - cached.at < REPLAY_MIN_INTERVAL_MS) return cached;
  }
  try {
    const record = await seam.read();
    if (record === null) return null;
    const result = { ...record, revision: seam.revision, at: Date.now() };
    logCostCache.set(sessionId, result);
    return result;
  } catch (error) {
    ctx.logger.warn("dsh-deepseek-quota: failed to replay session log for costing");
    ctx.logger.warn(error);
    return null;
  }
}

/** Whole-session log replay cache: sessionId -> { revision, calls, cost, ..., at }. */
const logCostCache = new Map();

function apply(ctx) {
  // ---- current-conversation cost ledger ----------------------------------
  // 订阅 session/event 实时累计（覆盖尚未落盘的进行中消息）；查询时优先用
  // 全量日志回放（replaySessionCost）以获得包含重启前历史的整段会话费用。
  const bySession = new Map();
  const headersBySession = new Map();

  ctx.on("session/event", (session, event) => {
    try {
      if (event?.type === "request/header" && event.data?.header?.config) {
        const header = event.data.header.config;
        if (typeof header.provider === "string" && typeof header.model === "string") {
          headersBySession.set(session.id, { provider: header.provider, model: header.model });
        }
        return;
      }
      if (event?.type !== "assistant/message") return;
      let record = bySession.get(session.id);
      if (record === void 0) {
        record = { ...emptyCostRecord(), updatedAt: 0 };
        bySession.set(session.id, record);
      }
      priceEventInto(record, event);
      record.updatedAt = event.time ?? Date.now();
    } catch (error) {
      ctx.logger.warn("dsh-deepseek-quota: failed to price an assistant/message event");
      ctx.logger.warn(error);
    }
  });

  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: ROUTE_PATH,
      handler: async (req, res) => {
        try {
          const hit = await ctx.credentials.resolve(CREDENTIAL_REF);
          if (hit === void 0) {
            sendJson(res, 503, {
              ok: false,
              error: "no-api-key",
              message: "未配置 DEEPSEEK_API_KEY：请在 设置 → 模型 中填写 DeepSeek API Key。"
            });
            return;
          }
          const response = await fetch(balanceUrl(), {
            headers: {
              Authorization: `Bearer ${hit.value}`,
              Accept: "application/json"
            },
            signal: AbortSignal.timeout(TIMEOUT_MS)
          });
          const text = await response.text();
          if (!response.ok) {
            sendJson(res, response.status, {
              ok: false,
              error: "provider",
              message: providerMessage(text, response.status)
            });
            return;
          }
          let body = null;
          try {
            body = JSON.parse(text);
          } catch {}
          // 平台接口固定返回多币种余额（CNY/USD），卡片只用 CNY。过滤掉零余额
          // 币种，避免接口里出现无意义的 USD 行（如 USD 0.00）。
          if (body && Array.isArray(body.balance_infos)) {
            const nonZero = body.balance_infos.filter((info) => info && toFinite(info.total_balance) > 0);
            if (nonZero.length > 0) body.balance_infos = nonZero;
          }
          const total = body && Array.isArray(body.balance_infos) ? Number(body.balance_infos[0]?.total_balance) : NaN;

          // Consumption: official platform data first, then the balance-delta
          // estimate (day + month). monthOpening — the blood-bar denominator —
          // is the first balance observed in the current local month; in
          // official mode a missing snapshot is back-derived from
          // `balance + official month spend` (fresh install mid-month).
          let todayConsumed = null;
          let monthConsumed = null;
          let consumedSource = "estimate";
          let monthOpening = null;
          const platformHit = await ctx.credentials.resolve(PLATFORM_TOKEN_REF);
          if (platformHit !== void 0) {
            try {
              const official = await fetchPlatformUsage(platformHit.value);
              if (official !== null) {
                todayConsumed = official.today;
                monthConsumed = official.month;
                consumedSource = "official";
              } else {
                ctx.logger.warn("dsh-deepseek-quota: platform usage returned no rows; falling back to the balance-delta estimate");
              }
            } catch (error) {
              ctx.logger.warn("dsh-deepseek-quota: platform usage fetch failed; falling back to the balance-delta estimate");
              ctx.logger.warn(error);
            }
          }
          if (Number.isFinite(total)) {
            if (consumedSource === "official") {
              const now = new Date();
              const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
              const today = localDate(now);
              const path = meterStatePath(ctx);
              const stored = loadMeterState(path);
              monthOpening = stored !== null && stored.month === monthKey && Number.isFinite(stored.monthOpening)
                ? stored.monthOpening
                : Math.max(0, Math.round((total + monthConsumed) * 100) / 100);
              const dayOpening = stored !== null && stored.day === today && Number.isFinite(stored.dayOpening)
                ? stored.dayOpening
                : total;
              saveMeterState(path, { month: monthKey, monthOpening, day: today, dayOpening, last: total });
            } else {
              const est = computeConsumed(ctx, total);
              if (est !== null) {
                todayConsumed = est.today;
                monthConsumed = est.month;
                monthOpening = est.monthOpening;
              }
            }
          }
          const ratio = Number.isFinite(monthOpening) && monthOpening > 0
            ? Math.min(1, Math.max(0, total / monthOpening))
            : 1;

          // 当前生效单价（按官方政策时间表实时计算，含峰谷与折扣政策）：
          // 客户端只负责展示，不再自带价格表，避免两处价格不同步。
          const priceNowMs = Date.now();
          const flashPrice = priceAt("deepseek-v4-flash", priceNowMs);
          const proPrice = priceAt("deepseek-v4-pro", priceNowMs);

          sendJson(res, 200, {
            ok: true,
            balance: body,
            todayConsumed,
            todayConsumedSource: consumedSource,
            monthConsumed,
            monthConsumedSource: consumedSource,
            monthOpening: Number.isFinite(monthOpening) ? Math.round(monthOpening * 100) / 100 : null,
            ratio: Math.round(ratio * 100) / 100,
            prices: {
              mode: flashPrice.mode,
              flash: flashPrice.cny,
              pro: proPrice.cny,
              policy: flashPrice.policy
            }
          });
        } catch (error) {
          ctx.logger.warn("dsh-deepseek-quota: failed to fetch DeepSeek balance");
          ctx.logger.warn(error);
          sendJson(res, 502, {
            ok: false,
            error: "fetch-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }),
    "dsh-deepseek-quota: balance route"
  );

  // 当前对话费用查询：GET /api/deepseek-session-cost?sessionId=<id>
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: SESSION_COST_ROUTE_PATH,
      handler: async (req, res) => {
        try {
          const sessionId = new URL(req.url ?? "/", "http://x").searchParams.get("sessionId") ?? "";
          // 优先：全量日志回放（包含重启前的历史，与 dsh 会话统计同源）。
          // 兜底：实时内存记账（覆盖尚未落盘的进行中消息）。
          let record = null;
          let source = null;
          if (sessionId !== "") {
            const replay = await replaySessionCost(ctx, sessionId);
            if (replay !== null) {
              record = replay;
              source = "log";
            } else {
              const live = bySession.get(sessionId);
              if (live !== void 0) {
                record = live;
                source = "live";
              }
            }
          }
          if (record === null) {
            sendJson(res, 200, {
              ok: true,
              sessionId,
              cost: null,
              costUsd: null,
              calls: 0,
              inputTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
              breakdown: null
            });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            sessionId,
            source,
            cost: roundCost(record.cost),
            costUsd: roundCost(record.costUsd),
            calls: record.calls,
            inputTokens: record.inputTokens,
            cacheReadTokens: record.cacheReadTokens,
            outputTokens: record.outputTokens,
            breakdown: breakdownOf(record)
          });
        } catch (error) {
          ctx.logger.warn("dsh-deepseek-quota: session-cost lookup failed");
          ctx.logger.warn(error);
          sendJson(res, 500, { ok: false, error: "internal", message: "internal error" });
        }
      }
    }),
    "dsh-deepseek-quota: session cost route"
  );
}

export { name, inject, apply };
