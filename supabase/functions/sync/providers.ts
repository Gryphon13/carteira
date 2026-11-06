// Fontes de dados de cada rede/corretora.
import { HDKey } from "npm:@scure/bip32@1.6.2";
import * as btc from "npm:@scure/btc-signer@1.6.0";

export type Holding = {
  network: string;
  symbol: string;
  name?: string | null;
  contract?: string | null;
  amount: number;
  price_usd?: number | null;
};
export type Tx = {
  network: string;
  tx_hash: string;
  ts: string | null;
  direction: "in" | "out" | "self" | "trade";
  symbol: string | null;
  amount: number | null;
  counterparty?: string | null;
  url?: string | null;
};
export type Result = { holdings: Holding[]; txs: Tx[]; meta?: any };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url: string, init: RequestInit = {}, tries = 3): Promise<any> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, {
      ...init,
      headers: { "User-Agent": "carteira-fabio/1.0", ...(init.headers || {}) },
    });
    if (r.status === 429 || r.status >= 500) {
      last = `${r.status} ${await r.text().catch(() => "")}`.slice(0, 200);
      await sleep(800 * (i + 1));
      continue;
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  throw new Error(`${new URL(url).host} indisponível (${last})`);
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- Bitcoin (Trezor)
const ESPLORA = ["https://mempool.space/api", "https://blockstream.info/api"];
async function esplora(path: string): Promise<any> {
  let err: unknown;
  for (const base of ESPLORA) {
    try {
      return await fetchJson(base + path);
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

const VERSIONS: Record<string, number> = { xpub: 0x0488b21e, ypub: 0x049d7cb2, zpub: 0x04b24746 };

function parseBtcInput(input: string): { key?: string; type: string; address?: string } {
  const s = input.trim();
  const m = s.match(/([xyz]pub[1-9A-HJ-NP-Za-km-z]{100,})/);
  if (!m) return { type: "address", address: s };
  const key = m[1];
  if (/^tr\(/i.test(s)) return { key, type: "p2tr" };
  if (/^sh\(wpkh/i.test(s)) return { key, type: "p2sh-p2wpkh" };
  if (/^wpkh\(/i.test(s)) return { key, type: "p2wpkh" };
  if (/^pkh\(/i.test(s)) return { key, type: "p2pkh" };
  const p = key.slice(0, 4);
  return { key, type: p === "zpub" ? "p2wpkh" : p === "ypub" ? "p2sh-p2wpkh" : "p2pkh" };
}

function addrFrom(pub: Uint8Array, type: string): string {
  if (type === "p2wpkh") return btc.p2wpkh(pub).address!;
  if (type === "p2sh-p2wpkh") return btc.p2sh(btc.p2wpkh(pub)).address!;
  if (type === "p2tr") return btc.p2tr(pub.slice(1)).address!;
  return btc.p2pkh(pub).address!;
}

export async function bitcoin(input: string, meta: any = {}): Promise<Result> {
  const parsed = parseBtcInput(input);
  type A = { address: string; funded: number; spent: number; txs: number; chain?: number; idx?: number };
  const used: A[] = [];
  let newMeta: any = undefined;

  const check = async (address: string): Promise<A> => {
    const d = await esplora(`/address/${address}`);
    return {
      address,
      funded: d.chain_stats.funded_txo_sum + d.mempool_stats.funded_txo_sum,
      spent: d.chain_stats.spent_txo_sum + d.mempool_stats.spent_txo_sum,
      txs: d.chain_stats.tx_count + d.mempool_stats.tx_count,
    };
  };

  if (parsed.type === "address") {
    used.push(await check(parsed.address!));
  } else {
    const hd = HDKey.fromExtendedKey(parsed.key!, { private: 0, public: VERSIONS[parsed.key!.slice(0, 4)] });
    const known: { chain: number; idx: number; address: string }[] = Array.isArray(meta?.used) && meta.type === parsed.type ? meta.used : [];
    const deadline = Date.now() + 60_000; // limite de tempo para não estourar a função
    // Endereços já conhecidos (descobertos pelo navegador ou em sincronizações anteriores)
    if (known.length) {
      const res = await pool(known, 4, async (k) => ({ ...(await check(k.address)), chain: k.chain, idx: k.idx }));
      used.push(...res.filter((a) => a.txs > 0));
    }
    // Procura endereços novos depois do último usado (gap menor quando já há histórico)
    const gapLimit = known.length ? 5 : 20;
    for (const chain of [0, 1]) {
      const node = hd.deriveChild(chain);
      const lastKnown = known.filter((k) => k.chain === chain).reduce((m, k) => Math.max(m, k.idx), -1);
      let idx = lastKnown + 1;
      let gap = 0;
      while (gap < gapLimit && idx < 2000) {
        if (Date.now() > deadline) throw new Error(`a leitura do Bitcoin passou de 60s (${used.length} endereços usados até o índice ${idx}). Atualize pela página para a primeira leitura ser feita pelo seu navegador.`);
        const n = gapLimit === 5 ? 5 : 10;
        const batch = Array.from({ length: n }, (_, k) => ({ idx: idx + k, address: addrFrom(node.deriveChild(idx + k).publicKey!, parsed.type) }));
        idx += n;
        const res = await pool(batch, 4, async (b) => ({ ...(await check(b.address)), chain, idx: b.idx }));
        for (const a of res) {
          if (a.txs > 0) {
            used.push(a);
            gap = 0;
          } else gap++;
        }
      }
    }
    newMeta = { type: parsed.type, used: used.map((a) => ({ chain: a.chain, idx: a.idx, address: a.address })), at: new Date().toISOString() };
  }

  const sats = used.reduce((s, a) => s + a.funded - a.spent, 0);
  const holdings: Holding[] = [{ network: "bitcoin", symbol: "BTC", name: "Bitcoin", amount: sats / 1e8 }];

  // Movimentações: últimas transações dos endereços usados
  const mine = new Set(used.map((a) => a.address));
  const seen = new Map<string, any>();
  const recent = used.slice(-15); // endereços mais recentes
  const lists = await pool(recent, 5, (a) => esplora(`/address/${a.address}/txs`).catch(() => []));
  for (const l of lists) for (const t of l as any[]) seen.set(t.txid, t);
  const txs: Tx[] = [...seen.values()]
    .map((t) => {
      const out = t.vout.filter((o: any) => mine.has(o.scriptpubkey_address)).reduce((s: number, o: any) => s + o.value, 0);
      const inn = t.vin.filter((i: any) => i.prevout && mine.has(i.prevout.scriptpubkey_address))
        .reduce((s: number, i: any) => s + i.prevout.value, 0);
      const net = out - inn;
      return {
        network: "bitcoin",
        tx_hash: t.txid,
        ts: t.status?.block_time ? new Date(t.status.block_time * 1000).toISOString() : new Date().toISOString(),
        direction: net > 0 ? "in" : net < 0 ? "out" : "self",
        symbol: "BTC",
        amount: Math.abs(net) / 1e8,
        url: `https://mempool.space/tx/${t.txid}`,
      } as Tx;
    })
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))
    .slice(0, 60);
  return { holdings, txs, meta: newMeta };
}

// ---------------------------------------------------------------- EVM (MetaMask, BSC...) via Alchemy
export const EVM_NETWORKS: Record<string, { native: string; name: string; explorer: string }> = {
  "eth-mainnet": { native: "ETH", name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  "bnb-mainnet": { native: "BNB", name: "BNB Smart Chain", explorer: "https://bscscan.com/tx/" },
  "matic-mainnet": { native: "POL", name: "Polygon", explorer: "https://polygonscan.com/tx/" },
  "arb-mainnet": { native: "ETH", name: "Arbitrum", explorer: "https://arbiscan.io/tx/" },
  "opt-mainnet": { native: "ETH", name: "Optimism", explorer: "https://optimistic.etherscan.io/tx/" },
  "base-mainnet": { native: "ETH", name: "Base", explorer: "https://basescan.org/tx/" },
  "avax-mainnet": { native: "AVAX", name: "Avalanche", explorer: "https://snowtrace.io/tx/" },
  "linea-mainnet": { native: "ETH", name: "Linea", explorer: "https://lineascan.build/tx/" },
  "zksync-mainnet": { native: "ETH", name: "zkSync", explorer: "https://explorer.zksync.io/tx/" },
  "scroll-mainnet": { native: "ETH", name: "Scroll", explorer: "https://scrollscan.com/tx/" },
};

function units(raw: string, decimals: number): number {
  const v = BigInt(raw);
  const d = 10n ** BigInt(decimals);
  return Number(v / d) + Number(v % d) / Number(d);
}

export async function evm(address: string, networks: string[]): Promise<Result> {
  const key = Deno.env.get("ALCHEMY_API_KEY");
  if (!key) throw new Error("Falta a chave da Alchemy (ALCHEMY_API_KEY) no Supabase");
  const nets = networks.length ? networks : ["eth-mainnet", "bnb-mainnet", "matic-mainnet", "arb-mainnet", "base-mainnet", "opt-mainnet"];
  const holdings: Holding[] = [];
  for (let i = 0; i < nets.length; i += 5) {
    const chunk = nets.slice(i, i + 5);
    let pageKey: string | undefined;
    do {
      const body: any = {
        addresses: [{ address, networks: chunk }],
        withMetadata: true,
        withPrices: true,
        includeNativeTokens: true,
        includeErc20Tokens: true,
      };
      if (pageKey) body.pageKey = pageKey;
      const r = await fetchJson(`https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      for (const t of r.data?.tokens ?? []) {
        if (t.error || !t.tokenBalance) continue;
        const native = !t.tokenAddress;
        const meta = t.tokenMetadata || {};
        const dec = native ? 18 : meta.decimals ?? 18;
        let amount = 0;
        try {
          amount = units(t.tokenBalance, dec);
        } catch {
          continue;
        }
        if (!(amount > 0)) continue;
        const price = (t.tokenPrices || []).find((p: any) => String(p.currency).toLowerCase() === "usd");
        holdings.push({
          network: t.network,
          symbol: (native ? EVM_NETWORKS[t.network]?.native : meta.symbol) || "?",
          name: native ? EVM_NETWORKS[t.network]?.name : meta.name,
          contract: t.tokenAddress ?? null,
          amount,
          price_usd: price ? Number(price.value) : null,
        });
      }
      pageKey = r.data?.pageKey || undefined;
    } while (pageKey);
  }

  // Movimentações (últimas 25 de entrada e de saída por rede)
  const priced = new Set(holdings.filter((h) => h.price_usd).map((h) => (h.contract || "").toLowerCase()));
  const txs: Tx[] = [];
  await pool(nets, 3, async (net) => {
    for (const dir of ["out", "in"] as const) {
      const params: any = {
        fromBlock: "0x0",
        toBlock: "latest",
        category: net === "eth-mainnet" || net === "matic-mainnet" ? ["external", "internal", "erc20"] : ["external", "erc20"],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: "0x19",
        order: "desc",
      };
      params[dir === "out" ? "fromAddress" : "toAddress"] = address;
      try {
        const r = await fetchJson(`https://${net}.g.alchemy.com/v2/${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "alchemy_getAssetTransfers", params: [params] }),
        });
        for (const t of r.result?.transfers ?? []) {
          const contract = (t.rawContract?.address || "").toLowerCase();
          // ignora tokens recebidos sem preço (quase sempre airdrop de spam)
          if (dir === "in" && t.category === "erc20" && !priced.has(contract)) continue;
          txs.push({
            network: net,
            tx_hash: t.hash,
            ts: t.metadata?.blockTimestamp ?? null,
            direction: dir,
            symbol: t.asset ?? null,
            amount: t.value ?? null,
            counterparty: dir === "out" ? t.to : t.from,
            url: (EVM_NETWORKS[net]?.explorer ?? "") + t.hash,
          });
        }
      } catch (_e) {
        // rede sem suporte a histórico: segue sem movimentações
      }
    }
  });
  return { holdings, txs };
}

// ---------------------------------------------------------------- Polkadot via Subscan
const DOT_NETS = ["polkadot", "assethub-polkadot"];
export async function polkadot(address: string): Promise<Result> {
  const key = Deno.env.get("SUBSCAN_API_KEY");
  if (!key) throw new Error("Falta a chave da Subscan (SUBSCAN_API_KEY) no Supabase");
  const post = (net: string, path: string, body: unknown) =>
    fetchJson(`https://${net}.api.subscan.io${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify(body),
    });
  const holdings: Holding[] = [];
  const txs: Tx[] = [];
  for (const net of DOT_NETS) {
    const r = await post(net, "/api/v2/scan/search", { key: address });
    if (r.code === 0 && r.data?.account) {
      const bal = Number(r.data.account.balance || 0);
      if (bal > 0) holdings.push({ network: net, symbol: "DOT", name: "Polkadot", amount: bal });
    } else if (r.code !== 10004) {
      throw new Error(`Subscan (${net}): ${r.message}`);
    }
    const t = await post(net, "/api/v2/scan/transfers", { address, row: 25, page: 0 });
    for (const x of t.data?.transfers ?? []) {
      if (!x.success) continue;
      const out = x.from === address;
      txs.push({
        network: net,
        tx_hash: x.hash,
        ts: new Date(x.block_timestamp * 1000).toISOString(),
        direction: out ? "out" : "in",
        symbol: x.asset_symbol || "DOT",
        amount: Number(x.amount),
        counterparty: out ? x.to : x.from,
        url: `https://${net}.subscan.io/extrinsic/${x.hash}`,
      });
    }
  }
  if (!holdings.length) holdings.push({ network: "polkadot", symbol: "DOT", name: "Polkadot", amount: 0 });
  return { holdings: holdings.filter((h) => h.amount > 0), txs };
}

// ---------------------------------------------------------------- Cardano via Koios
const KOIOS = "https://api.koios.rest/api/v1";
export async function cardano(input: string): Promise<Result> {
  const post = (path: string, body: unknown) =>
    fetchJson(KOIOS + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let stake: string | null = null;
  let addr: string | null = null;
  let lovelace = 0n;
  const s = input.trim();
  if (s.startsWith("stake1")) stake = s;
  else {
    addr = s;
    const info = await post("/address_info", { _addresses: [s] });
    stake = info?.[0]?.stake_address ?? null;
    if (!stake) lovelace = BigInt(info?.[0]?.balance ?? 0);
  }
  if (stake) {
    const acc = await post("/account_info", { _stake_addresses: [stake] });
    lovelace = BigInt(acc?.[0]?.total_balance ?? 0);
  }
  const holdings: Holding[] = [{ network: "cardano", symbol: "ADA", name: "Cardano", amount: Number(lovelace) / 1e6 }];

  // Movimentações
  const list: any[] = stake
    ? await fetchJson(`${KOIOS}/account_txs?_stake_address=${stake}&order=block_time.desc&limit=20`)
    : await post("/address_txs", { _addresses: [addr] });
  const last = list.sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0)).slice(0, 20);
  const txs: Tx[] = [];
  if (last.length) {
    const info = await post("/tx_info", { _tx_hashes: last.map((t) => t.tx_hash), _inputs: true });
    const isMine = (o: any) => (stake ? o.stake_addr === stake : o.payment_addr?.bech32 === addr);
    for (const t of info) {
      const out = (t.outputs || []).filter(isMine).reduce((s: number, o: any) => s + Number(o.value), 0);
      const inn = (t.inputs || []).filter(isMine).reduce((s: number, o: any) => s + Number(o.value), 0);
      const net = out - inn;
      txs.push({
        network: "cardano",
        tx_hash: t.tx_hash,
        ts: t.tx_timestamp ? new Date(t.tx_timestamp * 1000).toISOString() : null,
        direction: net > 0 ? "in" : net < 0 ? "out" : "self",
        symbol: "ADA",
        amount: Math.abs(net) / 1e6,
        url: `https://cardanoscan.io/transaction/${t.tx_hash}`,
      });
    }
  }
  return { holdings, txs };
}

// ---------------------------------------------------------------- Binance (chave só de leitura)
const BINANCE = "https://api.binance.com";
async function signed(path: string, params: Record<string, string | number> = {}, method = "GET"): Promise<any> {
  const apiKey = Deno.env.get("BINANCE_API_KEY");
  const secret = Deno.env.get("BINANCE_API_SECRET");
  if (!apiKey || !secret) throw new Error("Faltam BINANCE_API_KEY / BINANCE_API_SECRET no Supabase");
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), recvWindow: "10000", timestamp: String(Date.now()) });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(q.toString()));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return fetchJson(`${BINANCE}${path}?${q}&signature=${hex}`, { method, headers: { "X-MBX-APIKEY": apiKey } }, 2);
}

export async function binance(): Promise<Result> {
  const holdings: Holding[] = [];
  const add = (network: string, asset: string, amount: number) => {
    if (amount > 0) holdings.push({ network, symbol: asset, amount });
  };
  const acc = await signed("/api/v3/account", { omitZeroBalances: "true" });
  for (const b of acc.balances ?? []) add("binance-spot", b.asset, Number(b.free) + Number(b.locked));
  const fund = await signed("/sapi/v1/asset/get-funding-asset", {}, "POST").catch(() => []);
  for (const b of fund ?? []) add("binance-funding", b.asset, Number(b.free) + Number(b.locked) + Number(b.freeze || 0));
  const flex = await signed("/sapi/v1/simple-earn/flexible/position", { size: 100 }).catch(() => ({ rows: [] }));
  for (const r of flex.rows ?? []) add("binance-earn", r.asset, Number(r.totalAmount));
  const locked = await signed("/sapi/v1/simple-earn/locked/position", { size: 100 }).catch(() => ({ rows: [] }));
  for (const r of locked.rows ?? []) add("binance-earn", r.asset, Number(r.amount));

  const txs: Tx[] = [];
  const dep = await signed("/sapi/v1/capital/deposit/hisrec", { limit: 100 }).catch(() => []);
  for (const d of dep ?? []) {
    if (d.status !== 1 && d.status !== 6) continue;
    txs.push({
      network: "binance",
      tx_hash: d.txId || `dep-${d.id || d.insertTime}`,
      ts: new Date(d.insertTime).toISOString(),
      direction: "in",
      symbol: d.coin,
      amount: Number(d.amount),
      counterparty: `depósito via ${d.network}`,
      url: null,
    });
  }
  const wd = await signed("/sapi/v1/capital/withdraw/history", { limit: 100 }).catch(() => []);
  for (const w of wd ?? []) {
    if (w.status !== 6) continue;
    txs.push({
      network: "binance",
      tx_hash: w.txId || `wd-${w.id}`,
      ts: new Date(w.completeTime || w.applyTime + "Z").toISOString(),
      direction: "out",
      symbol: w.coin,
      amount: Number(w.amount),
      counterparty: `saque via ${w.network} para ${w.address}`,
      url: null,
    });
  }
  return { holdings, txs };
}

// ---------------------------------------------------------------- Preços
export async function binancePrices(): Promise<Map<string, number>> {
  const all = await fetchJson(`${BINANCE}/api/v3/ticker/price`);
  return new Map((all as any[]).map((p) => [p.symbol, Number(p.price)]));
}

const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDP", "USD1", "USDE", "PYUSD"]);
export function priceFromBinance(sym: string, m: Map<string, number>): number | null {
  const s = sym.toUpperCase();
  if (STABLE.has(s)) return m.get(`${s}USDT`) ?? 1;
  if (s === "BRL") return 1 / (m.get("USDTBRL") || 5.5);
  return m.get(`${s}USDT`) ?? m.get(`${s}FDUSD`) ?? m.get(`${s}USDC`) ??
    (m.get(`${s}BTC`) && m.get("BTCUSDT") ? m.get(`${s}BTC`)! * m.get("BTCUSDT")! : null);
}

// Yahoo Finance: B3 e dólar comercial
export async function yahoo(symbol: string): Promise<{ price: number; prev: number; time: number; currency: string } | null> {
  try {
    const r = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const m = r.chart?.result?.[0]?.meta;
    if (!m) return null;
    return { price: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose, time: m.regularMarketTime, currency: m.currency };
  } catch {
    return null;
  }
}
