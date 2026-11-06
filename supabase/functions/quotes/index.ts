// Cotações de B3 (atraso ~15 min) e dólar comercial, via Yahoo Finance.
// GET/POST { symbols: ["PETR4","PETR3"] }
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let symbols: string[] = [];
  if (req.method === "POST") symbols = (await req.json().catch(() => ({}))).symbols || [];
  else symbols = (new URL(req.url).searchParams.get("symbols") || "").split(",").filter(Boolean);
  symbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{4,7}$/.test(s)))].slice(0, 40);

  const [fx, ...list] = await Promise.all([yahoo("BRL=X"), ...symbols.map((s) => yahoo(`${s}.SA`))]);
  const b3: Record<string, unknown> = {};
  symbols.forEach((s, i) => (b3[s] = list[i]));
  return new Response(JSON.stringify({ fx, b3, at: Date.now() }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
