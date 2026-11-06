// Sincroniza saldos e movimentações de todas as carteiras e grava uma foto do patrimônio.
// Chamada pela página (usuário logado) ou pelo agendamento diário (cabeçalho x-cron-secret).
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { binance, binancePrices, bitcoin, cardano, evm, Holding, polkadot, priceFromBinance, Result, yahoo } from "./providers.ts";

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

async function runWallet(w: any): Promise<Result> {
  switch (w.kind) {
    case "btc":
      return bitcoin(w.address, w.meta);
    case "evm":
      return evm(w.address, w.networks || []);
    case "polkadot":
      return polkadot(w.address);
    case "cardano":
      return cardano(w.address);
    case "binance":
      return binance();
    default:
      throw new Error(`tipo desconhecido: ${w.kind}`);
  }
}

async function syncUser(userId: string, onlyWallet?: string) {
  let q = admin.from("wallets").select("*").eq("user_id", userId).eq("active", true);
  if (onlyWallet) q = q.eq("id", onlyWallet);
  const { data: wallets, error } = await q;
  if (error) throw error;

  const prices = await binancePrices();
  const report: any[] = [];

  const results = await Promise.all(
    (wallets ?? []).map(async (w) => {
      const t0 = Date.now();
      try {
        const r = await runWallet(w);
        return { w, r, ms: Date.now() - t0 };
      } catch (e) {
        return { w, err: String((e as Error).message || e), ms: Date.now() - t0 };
      }
    }),
  );

  for (const { w, r, err, ms } of results as any[]) {
    if (err) {
      report.push({ carteira: w.label, ok: false, erro: err, ms });
      continue;
    }
    const rows = (r.holdings as Holding[]).map((h) => {
      let symbol = h.symbol;
      let price = h.price_usd ?? null;
      if (w.kind === "binance" && symbol.startsWith("LD") && priceFromBinance(symbol, prices) == null) {
        const base = symbol.slice(2);
        if (priceFromBinance(base, prices) != null) symbol = base; // LDBTC (Earn antigo) -> BTC
      }
      if (price == null || !isFinite(price)) price = priceFromBinance(symbol, prices);
      return {
        user_id: userId,
        wallet_id: w.id,
        source: w.label,
        network: h.network,
        symbol: symbol.toUpperCase(),
        name: h.name ?? null,
        contract: h.contract ?? null,
        amount: h.amount,
        price_usd: price,
        value_usd: price != null ? price * h.amount : null,
      };
    });
    if (r.meta) await admin.from("wallets").update({ meta: r.meta }).eq("id", w.id);
    await admin.from("holdings").delete().eq("wallet_id", w.id);
    if (rows.length) {
      const { error: e1 } = await admin.from("holdings").insert(rows);
      if (e1) throw e1;
    }
    const txs = (r.txs as any[]).map((t) => ({ ...t, user_id: userId, wallet_id: w.id, source: w.label }));
    if (txs.length) {
      const { error: e2 } = await admin.from("transactions").upsert(txs, {
        onConflict: "user_id,network,tx_hash,symbol,direction",
        ignoreDuplicates: true,
      });
      if (e2) report.push({ carteira: w.label, aviso: `movimentações: ${e2.message}` });
    }
    report.push({ carteira: w.label, ok: true, ativos: rows.length, movimentacoes: txs.length, ms });
  }

  // Carteiras desativadas saem do patrimônio
  const { data: inactive } = await admin.from("wallets").select("id").eq("user_id", userId).eq("active", false);
  if (inactive?.length) await admin.from("holdings").delete().in("wallet_id", inactive.map((w) => w.id));

  // Foto do patrimônio
  const { data: all } = await admin.from("holdings").select("symbol, source, value_usd").eq("user_id", userId);
  const cryptoUsd = (all ?? []).reduce((s, h) => s + Number(h.value_usd || 0), 0);
  const bySymbol: Record<string, number> = {};
  for (const h of all ?? []) bySymbol[h.symbol] = (bySymbol[h.symbol] || 0) + Number(h.value_usd || 0);

  const fx = await yahoo("BRL=X");
  const usdBrl = fx?.price || prices.get("USDTBRL") || null;

  const { data: manual } = await admin.from("manual_assets").select("*").eq("user_id", userId);
  let b3Brl = 0, rfBrl = 0, otherBrl = 0;
  for (const a of manual ?? []) {
    const toBrl = (v: number) => (a.currency === "USD" ? v * (usdBrl || 0) : v);
    if (a.kind === "b3") {
      const qt = await yahoo(`${a.symbol.toUpperCase()}.SA`);
      const px = qt?.price ?? Number(a.avg_price || 0);
      b3Brl += toBrl(px * Number(a.quantity));
    } else if (a.kind === "renda_fixa") {
      rfBrl += toBrl(Number(a.current_value ?? Number(a.avg_price || 0) * Number(a.quantity)));
    } else {
      otherBrl += toBrl(Number(a.current_value ?? Number(a.avg_price || 0) * Number(a.quantity)));
    }
  }
  const totalBrl = usdBrl ? cryptoUsd * usdBrl + b3Brl + rfBrl + otherBrl : null;
  const totalUsd = usdBrl ? cryptoUsd + (b3Brl + rfBrl + otherBrl) / usdBrl : cryptoUsd;
  await admin.from("snapshots").insert({
    user_id: userId,
    total_usd: totalUsd,
    usd_brl: usdBrl,
    total_brl: totalBrl,
    breakdown: { cripto_usd: cryptoUsd, b3_brl: b3Brl, renda_fixa_brl: rfBrl, outros_brl: otherBrl, por_ativo_usd: bySymbol },
  });

  return { carteiras: report, total_usd: totalUsd, total_brl: totalBrl, usd_brl: usdBrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data } = await admin.from("app_config").select("value").eq("key", "cron_secret").single();
      if (!data || data.value !== cronSecret) return json({ erro: "não autorizado" }, 401);
      if (body.teste) {
        // diagnóstico: roda uma fonte sem gravar nada
        const t0 = Date.now();
        try {
          const r = await runWallet(body.teste);
          return json({ ms: Date.now() - t0, holdings: r.holdings, txs: r.txs.slice(0, 5), n_txs: r.txs.length });
        } catch (e) {
          return json({ ms: Date.now() - t0, erro: String((e as Error).message || e) });
        }
      }
      const { data: allowed } = await admin.from("allowed_users").select("email");
      const emails = new Set((allowed ?? []).map((a) => a.email.toLowerCase()));
      const { data: users } = await admin.auth.admin.listUsers();
      const out: any[] = [];
      for (const u of users?.users ?? []) {
        if (u.email && emails.has(u.email.toLowerCase())) out.push(await syncUser(u.id));
      }
      return json({ ok: true, usuarios: out.length, resultado: out });
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ erro: "faça login" }, 401);
    const { data: ok } = await admin.from("allowed_users").select("email").ilike("email", u.user.email || "-").maybeSingle();
    if (!ok) return json({ erro: "usuário sem permissão" }, 403);
    return json({ ok: true, ...(await syncUser(u.user.id, body.wallet_id)) });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
