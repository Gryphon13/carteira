// Cotações de B3 (atraso ~15 min) e dólar comercial, via Yahoo Finance.
// POST { symbols: ["PETR4","PETR3"] }  -> cotação atual
// POST { history: "PETR4", from: "2026-10-01" } -> fechamentos diários desde a data
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json" } });

const cache = new Map<string, { t: number; v: any }>();

async function yahoo(symbol: string) {
  const c = cache.get(symbol);
  if (c && Date.now() - c.t < 20_000) return c.v;
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const m = j.chart?.result?.[0]?.meta;
    if (!m) return null;
    const v = {
      price: m.regularMarketPrice,
      prev: m.chartPreviousClose ?? m.previousClose,
      time: m.regularMarketTime,
      currency: m.currency,
      name: m.longName || m.shortName || null,
    };
    cache.set(symbol, { t: Date.now(), v });
    return v;
  } catch {
    return null;
  }
}

async function history(symbol: string, from: string) {
  const p1 = Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000) - 86400 * 3;
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!r.ok) return [];
  const j = await r.json();
  const res = j.chart?.result?.[0];
  const ts: number[] = res?.timestamp || [];
  const close: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
  return ts.map((t, i) => ({ t, c: close[i] })).filter((x) => x.c != null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (body.history) {
    const sym = String(body.history).trim().toUpperCase();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || "") ? body.from : new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10);
    if (!/^[A-Z0-9]{4,7}$/.test(sym)) return json({ pontos: [] });
    return json({ pontos: await history(`${sym}.SA`, from) });
  }
  let symbols: string[] = body.symbols || (new URL(req.url).searchParams.get("symbols") || "").split(",").filter(Boolean);
  symbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{4,7}$/.test(s)))].slice(0, 40);

  const [fx, ...list] = await Promise.all([yahoo("BRL=X"), ...symbols.map((s) => yahoo(`${s}.SA`))]);
  const b3: Record<string, unknown> = {};
  symbols.forEach((s, i) => (b3[s] = list[i]));
  return json({ fx, b3, at: Date.now() });
});
