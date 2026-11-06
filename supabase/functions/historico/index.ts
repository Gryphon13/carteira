// Importa o histórico de operações da Binance (spot, convert e compras com reais),
// calcula o preço médio de cada ativo e grava as compras/vendas em Movimentações.
// Incremental: cada chamada continua de onde a anterior parou.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const BINANCE = "https://api.binance.com";
const DAY = 86_400_000;
const START = Date.UTC(2019, 0, 1); // até onde voltar no tempo
const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDP", "USD1", "USDE", "PYUSD"]);
const QUOTES = ["USDT", "FDUSD", "USDC", "BRL", "BTC", "ETH", "BNB", "BUSD", "TUSD"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string, init: RequestInit = {}, tries = 3): Promise<any> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, init);
    if (r.status === 429 || r.status === 418 || r.status >= 500) {
      last = `${r.status} ${(await r.text().catch(() => "")).slice(0, 150)}`;
      const wait = Number(r.headers.get("retry-after") || 0) * 1000 || 1500 * (i + 1);
      if (r.status === 418 || wait > 20_000) break;
      await sleep(wait);
      continue;
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`Binance ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
  throw new Error(`Binance limitou as consultas (${last}). Tente de novo em alguns minutos.`);
}

async function signed(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const apiKey = Deno.env.get("BINANCE_API_KEY");
  const secret = Deno.env.get("BINANCE_API_SECRET");
  if (!apiKey || !secret) throw new Error("Faltam BINANCE_API_KEY / BINANCE_API_SECRET no Supabase");
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), recvWindow: "15000", timestamp: String(Date.now()) });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(q.toString()));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return fetchJson(`${BINANCE}${path}?${q}&signature=${hex}`, { headers: { "X-MBX-APIKEY": apiKey } });
}

// ---------------------------------------------------------------- preços históricos (fechamento diário)
const klines = new Map<string, Map<number, number>>();
const fetched = new Map<string, [number, number][]>(); // períodos já consultados por par
async function close(sym: string, ts: number): Promise<number | null> {
  const day = Math.floor(ts / DAY) * DAY;
  let m = klines.get(sym);
  if (!m) klines.set(sym, (m = new Map()));
  if (m.has(day)) return m.get(day)!;
  const ranges = fetched.get(sym) || [];
  if (!ranges.some(([a, b]) => day >= a && day <= b)) {
    const start = day - 400 * DAY;
    ranges.push([start, start + 999 * DAY]);
    fetched.set(sym, ranges);
    try {
      const k = await fetchJson(`${BINANCE}/api/v3/klines?symbol=${sym}&interval=1d&startTime=${start}&limit=1000`);
      for (const c of k as any[]) m.set(c[0], Number(c[4]));
    } catch { /* par inexistente */ }
  }
  let best: number | null = null, dist = Infinity;
  for (const [d, v] of m) if (Math.abs(d - day) < dist) { dist = Math.abs(d - day); best = v; }
  const v = dist <= 7 * DAY ? best : null;
  if (v != null) m.set(day, v);
  return v;
}
async function usdAt(asset: string, ts: number): Promise<number | null> {
  if (STABLE.has(asset)) return 1;
  if (asset === "BRL") {
    const r = await close("USDTBRL", ts);
    return r ? 1 / r : null;
  }
  return close(`${asset}USDT`, ts);
}
async function brlPerUsd(ts: number): Promise<number> {
  return (await close("USDTBRL", ts)) || 5.2;
}

// ---------------------------------------------------------------- estado
async function getState(userId: string): Promise<Map<string, string>> {
  const { data } = await admin.from("sync_state").select("key,value").eq("user_id", userId);
  return new Map((data ?? []).map((r) => [r.key, r.value]));
}
async function setState(userId: string, key: string, value: string | number) {
  await admin.from("sync_state").upsert({ user_id: userId, key, value: String(value) });
}
async function saveTrades(userId: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("binance_trades").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, user_id: userId })), { onConflict: "user_id,id", ignoreDuplicates: true });
    if (error) throw error;
  }
}

async function run(userId: string) {
  const t0 = Date.now();
  const left = () => 110_000 - (Date.now() - t0);
  const state = await getState(userId);
  const rep: any = { spot: { pares: 0, novas: 0 }, convert: { novas: 0 }, compras_com_reais: { novas: 0 }, completo: true };

  // ---------- 1) Spot: todos os pares dos ativos que você tem ou já teve
  const tick = await fetchJson(`${BINANCE}/api/v3/ticker/price`);
  const exists = new Set((tick as any[]).map((t) => t.symbol));
  const { data: hold } = await admin.from("holdings").select("symbol").eq("user_id", userId);
  const { data: past } = await admin.from("binance_trades").select("base").eq("user_id", userId).neq("kind", "csv").limit(5000);
  const assets = new Set([...(hold ?? []).map((h) => h.symbol), ...(past ?? []).map((p) => p.base)]);
  const pairs: { sym: string; base: string; quote: string }[] = [];
  for (const a of assets) for (const q of QUOTES) if (a !== q && exists.has(a + q)) pairs.push({ sym: a + q, base: a, quote: q });
  rep.spot.pares = pairs.length;
  let pi = 0;
  const worker = async () => {
    while (pi < pairs.length && left() > 40_000) {
      const p = pairs[pi++];
      let from = Number(state.get(`spot:${p.sym}`) ?? -1) + 1;
      while (left() > 40_000) {
        const list = await signed("/api/v3/myTrades", { symbol: p.sym, fromId: from, limit: 1000 });
        if (!list.length) break;
        await saveTrades(userId, list.map((t: any) => ({
          id: `spot:${p.sym}:${t.id}`, kind: "spot", ts: new Date(t.time).toISOString(), base: p.base, quote: p.quote,
          base_qty: Number(t.qty), quote_qty: Number(t.quoteQty), is_buy: !!t.isBuyer, fee: Number(t.commission), fee_asset: t.commissionAsset,
        })));
        rep.spot.novas += list.length;
        from = list[list.length - 1].id + 1;
        await setState(userId, `spot:${p.sym}`, from - 1);
        if (list.length < 1000) break;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (pi < pairs.length) rep.completo = false;

  // ---------- 2) Convert e compras com reais: janelas de 30 dias
  // primeiro o período novo (desde a última vez), depois volta no tempo até 2019
  const now = Date.now();
  let newest = Number(state.get("win:newest") ?? 0);
  let oldest = Number(state.get("win:oldest") ?? 0);
  if (!newest) { newest = now - 30 * DAY; oldest = now - 30 * DAY; }
  const windows: [number, number][] = [];
  for (let s = newest; s < now; s += 30 * DAY) windows.push([s, Math.min(s + 30 * DAY - 1, now)]);
  for (let e = oldest; e > START; e -= 30 * DAY) windows.push([Math.max(e - 30 * DAY, START), e - 1]);
  let lastConvert = 0;
  for (const [s, e] of windows) {
    if (left() < 8_000) { rep.completo = false; break; }
    // convert: no máximo ~1 consulta por segundo (limite da Binance)
    const wait = 1100 - (Date.now() - lastConvert);
    if (wait > 0) await sleep(wait);
    lastConvert = Date.now();
    const cv = await signed("/sapi/v1/convert/tradeFlow", { startTime: s, endTime: e, limit: 1000 });
    const cvRows = (cv.list ?? []).filter((x: any) => x.orderStatus === "SUCCESS").map((x: any) => ({
      id: `convert:${x.orderId}`, kind: "convert", ts: new Date(x.createTime).toISOString(), base: x.toAsset, quote: x.fromAsset,
      base_qty: Number(x.toAmount), quote_qty: Number(x.fromAmount), is_buy: true, fee: null, fee_asset: null,
    }));
    const fiatRows: any[] = [];
    for (const type of [0, 1]) {
      for (let page = 1; page < 20; page++) {
        const fp = await signed("/sapi/v1/fiat/payments", { transactionType: type, beginTime: s, endTime: e, page, rows: 500 }).catch(() => ({ data: [] }));
        const data = (fp.data ?? []).filter((x: any) => String(x.status).toLowerCase() === "completed");
        for (const x of data) {
          fiatRows.push(type === 0
            ? { id: `fiat:${x.orderNo}`, kind: "fiat", ts: new Date(Number(x.createTime)).toISOString(), base: x.cryptoCurrency, quote: x.fiatCurrency, base_qty: Number(x.obtainAmount), quote_qty: Number(x.sourceAmount), is_buy: true, fee: Number(x.totalFee || 0), fee_asset: x.fiatCurrency }
            : { id: `fiat:${x.orderNo}`, kind: "fiat", ts: new Date(Number(x.createTime)).toISOString(), base: x.cryptoCurrency, quote: x.fiatCurrency, base_qty: Number(x.sourceAmount), quote_qty: Number(x.obtainAmount), is_buy: false, fee: Number(x.totalFee || 0), fee_asset: x.fiatCurrency });
        }
        if ((fp.data ?? []).length < 500) break;
      }
    }
    await saveTrades(userId, [...cvRows, ...fiatRows]);
    rep.convert.novas += cvRows.length;
    rep.compras_com_reais.novas += fiatRows.length;
    if (s >= newest) { newest = Math.max(newest, Math.min(e + 1, now)); await setState(userId, "win:newest", newest); }
    else { oldest = Math.min(oldest, s); await setState(userId, "win:oldest", oldest); }
  }
  rep.historico_ate = new Date(Math.max(oldest, START)).toISOString().slice(0, 10);

  // ---------- 3) Preço médio (custo médio ponderado) e movimentações
  const trades: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("binance_trades").select("*").eq("user_id", userId).order("ts").order("id").range(from, from + 999);
    trades.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  type Pos = { qty: number; usd: number; brl: number; n: number; first: string | null; last: string | null };
  const pos = new Map<string, Pos>();
  const P = (a: string) => pos.get(a) || (pos.set(a, { qty: 0, usd: 0, brl: 0, n: 0, first: null, last: null }), pos.get(a)!);
  const add = (a: string, q: number, usd: number, brl: number, ts: string) => {
    if (STABLE.has(a) || a === "BRL" || !(q > 0)) return;
    const p = P(a);
    p.qty += q; p.usd += usd; p.brl += brl; p.n++;
    p.first ??= ts; p.last = ts;
  };
  const sub = (a: string, q: number, ts: string) => {
    if (STABLE.has(a) || a === "BRL" || !(q > 0)) return;
    const p = P(a);
    if (p.qty > 0) {
      const f = Math.min(q, p.qty) / p.qty;
      p.usd *= 1 - f; p.brl *= 1 - f; p.qty -= Math.min(q, p.qty);
    }
    p.n++; p.last = ts;
  };
  const txRows: any[] = [];
  for (const t of trades ?? []) {
    const ts = new Date(t.ts).getTime();
    const bq = Number(t.base_qty), qq = Number(t.quote_qty);
    let usd: number | null = null;
    if (STABLE.has(t.quote)) usd = qq;
    else if (t.quote === "BRL") usd = qq / (await brlPerUsd(ts));
    else { const px = await usdAt(t.quote, ts); if (px) usd = qq * px; }
    if (usd == null) { const px = await usdAt(t.base, ts); usd = px ? bq * px : 0; }
    const brl = t.quote === "BRL" ? qq : usd * (await brlPerUsd(ts));
    const feeBase = t.fee_asset === t.base ? Number(t.fee || 0) : 0;
    const feeQuote = t.fee_asset === t.quote ? Number(t.fee || 0) : 0;
    if (t.is_buy) {
      add(t.base, bq - feeBase, usd, brl, t.ts);
      sub(t.quote, qq, t.ts);
    } else {
      sub(t.base, bq, t.ts);
      add(t.quote, qq - feeQuote, usd, brl, t.ts);
    }
    if (t.fee_asset && t.fee_asset !== t.base && t.fee_asset !== t.quote) sub(t.fee_asset, Number(t.fee || 0), t.ts);
    txRows.push({
      user_id: userId, wallet_id: null, source: "Binance", network: "binance", tx_hash: t.id, ts: t.ts,
      direction: t.is_buy ? "buy" : "sell", symbol: t.base, amount: bq, quote_asset: t.quote, quote_amount: qq,
      counterparty: t.kind === "convert" ? `Convert ${t.quote} → ${t.base}` : t.kind === "fiat" ? `${t.is_buy ? "Compra" : "Venda"} com ${t.quote}` : t.kind === "csv" ? `Extrato ${t.base}/${t.quote}` : `Spot ${t.base}/${t.quote}`,
      url: null,
    });
  }
  // liga as movimentações à carteira Binance (se existir)
  const { data: bw } = await admin.from("wallets").select("id,label").eq("user_id", userId).eq("kind", "binance").limit(1).maybeSingle();
  for (const r of txRows) { r.wallet_id = bw?.id ?? null; r.source = bw?.label ?? "Binance"; }
  for (let i = 0; i < txRows.length; i += 500) {
    await admin.from("transactions").upsert(txRows.slice(i, i + 500), { onConflict: "user_id,network,tx_hash,symbol,direction", ignoreDuplicates: true });
  }
  const cb = [...pos.entries()].filter(([, p]) => p.qty > 1e-12 && p.usd > 0).map(([symbol, p]) => ({
    user_id: userId, symbol, qty: p.qty, cost_usd: p.usd, cost_brl: p.brl, n_ops: p.n, first_ts: p.first, last_ts: p.last, updated_at: new Date().toISOString(),
  }));
  await admin.from("cost_basis").delete().eq("user_id", userId);
  if (cb.length) await admin.from("cost_basis").insert(cb);
  rep.operacoes = trades?.length ?? 0;
  rep.ativos_com_preco_medio = cb.length;
  rep.ms = Date.now() - t0;
  return rep;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data } = await admin.from("app_config").select("value").eq("key", "cron_secret").single();
      if (!data || data.value !== cronSecret) return json({ erro: "não autorizado" }, 401);
      const { data: allowed } = await admin.from("allowed_users").select("email");
      const emails = new Set((allowed ?? []).map((a) => a.email.toLowerCase()));
      const { data: users } = await admin.auth.admin.listUsers();
      const out: any[] = [];
      for (const u of users?.users ?? []) {
        if (!u.email || !emails.has(u.email.toLowerCase())) continue;
        const { data: w } = await admin.from("wallets").select("id").eq("user_id", u.id).eq("kind", "binance").eq("active", true).limit(1);
        if (w?.length) out.push(await run(u.id));
      }
      return json({ ok: true, resultado: out });
    }
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ erro: "faça login" }, 401);
    const { data: ok } = await admin.from("allowed_users").select("email").ilike("email", u.user.email || "-").maybeSingle();
    if (!ok) return json({ erro: "usuário sem permissão" }, 403);
    return json({ ok: true, ...(await run(u.user.id)) });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
