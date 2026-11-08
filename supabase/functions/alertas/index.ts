// Metas de compra e venda: confere os preços a cada 10 minutos (pg_cron) e avisa no celular pelo ntfy.
// Também atende a página (usuário logado) para enviar uma notificação de teste.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const APP = "https://gryphon13.github.io/carteira/";
const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDP", "USD1", "USDE", "PYUSD"]);

const fmtUsd = (v: number) => "US$ " + new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: v >= 1 ? 7 : 4, minimumFractionDigits: v >= 1 && v < 1000 ? 2 : 0 }).format(v);
const fmtBrl = (v: number) => "R$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: v >= 1 ? 2 : 6 }).format(v);

async function ntfy(topic: string, title: string, message: string, extra: Record<string, unknown> = {}) {
  const r = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, title, message, click: APP, ...extra }),
  });
  if (!r.ok) throw new Error(`ntfy respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
}
// e-mail: pelo Resend se houver chave (RESEND_API_KEY); senão, pelo próprio ntfy (encaminhamento grátis)
async function email(to: string, title: string, message: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: "Carteira <onboarding@resend.dev>", to: [to], subject: title, text: `${message}\n\nAbrir a carteira: ${APP}` }),
    });
    if (!r.ok) throw new Error(`e-mail (Resend) respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
    return;
  }
  await ntfy("carteira-mail-" + crypto.randomUUID(), title, message, { email: to }).catch((e) => {
    throw new Error("e-mail: " + String(e.message || e));
  });
}
type Prefs = { ntfy_topic?: string | null; notify_email?: string | null };
// envia por todos os canais configurados; devolve o que funcionou e os erros
async function notify(pf: Prefs | undefined, title: string, message: string, extra: Record<string, unknown> = {}) {
  const ok: string[] = [], errs: string[] = [];
  if (pf?.ntfy_topic) await ntfy(pf.ntfy_topic, title, message, extra).then(() => ok.push("celular"), (e) => errs.push(String(e.message || e)));
  if (pf?.notify_email) await email(pf.notify_email, title, message).then(() => ok.push("e-mail"), (e) => errs.push(String(e.message || e)));
  return { ok, errs };
}

// máxima, mínima e último preço dos últimos ~15 min (pega picos entre uma conferência e outra)
async function priceRange(sym: string): Promise<{ hi: number; lo: number; last: number } | null> {
  if (STABLE.has(sym)) return { hi: 1, lo: 1, last: 1 };
  for (const q of ["USDT", "FDUSD", "USDC"]) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}${q}&interval=5m&limit=3`);
      if (!r.ok) continue;
      const k = (await r.json()) as any[];
      if (!k.length) continue;
      return { hi: Math.max(...k.map((x) => Number(x[2]))), lo: Math.min(...k.map((x) => Number(x[3]))), last: Number(k[k.length - 1][4]) };
    } catch { /* tenta o próximo par */ }
  }
  try { // moedas fora da Binance (ex.: CRO)
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${sym.toLowerCase()}&include_tokens=top`);
    if (r.ok) {
      const d = (await r.json()) as any[];
      const p = d.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))[0]?.current_price;
      if (p) return { hi: p, lo: p, last: p };
    }
  } catch { /* sem preço */ }
  return null;
}

async function usdBrl(): Promise<number | null> {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL");
    return Number((await r.json()).price) || null;
  } catch { return null; }
}

async function check() {
  const { data: targets, error } = await admin.from("sell_targets").select("*").eq("active", true).is("hit_at", null);
  if (error) throw error;
  if (!targets?.length) return { metas: 0, atingidas: 0 };
  const syms = [...new Set(targets.map((t) => t.symbol.toUpperCase()))];
  const prices = new Map<string, { hi: number; lo: number; last: number } | null>();
  await Promise.all(syms.map(async (s) => prices.set(s, await priceRange(s))));
  const { data: prefs } = await admin.from("user_prefs").select("user_id, ntfy_topic, notify_email").in("user_id", [...new Set(targets.map((t) => t.user_id))]);
  const prefOf = new Map((prefs ?? []).map((p) => [p.user_id, p as Prefs]));
  const brl = await usdBrl();
  const out: any[] = [];
  for (const t of targets) {
    const p = prices.get(t.symbol.toUpperCase());
    if (!p) continue;
    const target = Number(t.price_usd);
    const hit = t.direction === "up" ? p.hi >= target : p.lo <= target;
    if (!hit) continue;
    const verb = t.direction === "up" ? "chegou a" : "caiu para";
    const buy = t.kind === "buy";
    const title = `${buy ? "🛒" : "🎯"} ${t.symbol} ${verb} ${fmtUsd(target)}`;
    const what = buy
      ? (t.buy_usd ? `Sua meta: comprar ${fmtUsd(Number(t.buy_usd))}${brl ? ` (${fmtBrl(Number(t.buy_usd) * brl)})` : ""} ≈ ${(Number(t.buy_usd) / p.last).toLocaleString("pt-BR", { maximumSignificantDigits: 6 })} ${t.symbol}.` : "Meta de compra atingida.")
      : t.sell_pct ? `Sua meta: vender ${Number(t.sell_pct).toLocaleString("pt-BR")}% da posição.` : t.direction === "up" ? "Meta de venda atingida." : "Alerta de queda atingido.";
    const lines = [`Preço agora: ${fmtUsd(p.last)}${brl ? ` (${fmtBrl(p.last * brl)})` : ""}.`, what, t.note ? `Nota: ${t.note}` : ""].filter(Boolean);
    const res = await notify(prefOf.get(t.user_id), title, lines.join("\n"), { tags: [t.direction === "up" ? "chart_with_upwards_trend" : "chart_with_downwards_trend"], priority: 4 });
    const notified = res.ok.length > 0, err = res.errs.join(" | ");
    await admin.from("sell_targets").update({ hit_at: new Date().toISOString(), hit_price: p.last, active: false, notified }).eq("id", t.id);
    out.push({ symbol: t.symbol, alvo: target, preco: p.last, avisado: notified, erro: err || undefined });
  }
  return { metas: targets.length, atingidas: out.length, detalhes: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data } = await admin.from("app_config").select("value").eq("key", "cron_secret").single();
      if (!data || data.value !== cronSecret) return json({ erro: "não autorizado" }, 401);
      if (body.ping) { // diagnóstico: alcance do ntfy a partir da função
        try { await ntfy("carteira-ping-" + crypto.randomUUID(), "ping", "ok"); return json({ ok: true }); } catch (e) { return json({ ok: false, erro: String((e as Error).message || e) }); }
      }
      return json({ ok: true, ...(await check()) });
    }
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ erro: "faça login" }, 401);
    const { data: ok } = await admin.from("allowed_users").select("email").ilike("email", u.user.email || "-").maybeSingle();
    if (!ok) return json({ erro: "usuário sem permissão" }, 403);
    if (body.teste) {
      const { data: pf } = await admin.from("user_prefs").select("ntfy_topic, notify_email").eq("user_id", u.user.id).maybeSingle();
      if (!pf?.ntfy_topic && !pf?.notify_email) return json({ erro: "Configure o celular ou o e-mail primeiro." }, 400);
      const res = await notify(pf, "✅ Carteira: avisos funcionando", "Você vai receber aqui quando um ativo chegar numa meta de compra ou de venda.", { tags: ["bell"] });
      return json({ ok: res.errs.length === 0, canais: res.ok, erros: res.errs });
    }
    return json({ erro: "nada a fazer" }, 400);
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
