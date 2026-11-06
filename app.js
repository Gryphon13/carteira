import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm";

// Endereço e chave pública do projeto (a chave pública é feita para ficar no navegador;
// quem protege os dados são as regras de acesso do banco).
const SUPABASE_URL = "https://agfetzppqisffbfkdfaw.supabase.co";
const SUPABASE_KEY = "sb_publishable_eAyyeb_yKTRcJNABrRAh3g_aI0Fle5R";
const REGION = "sa-east-1";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ------------------------------------------------------------------ estado
const S = {
  user: null,
  wallets: [],
  holdings: [],
  manual: [],
  settings: {},
  txs: [],
  snaps: [],
  live: {}, // SYM -> { p, o } preço e abertura 24h (Binance, em USDT)
  fx: { com: null, comPrev: null, usdt: null },
  b3: {},
  ccy: store("ccy") || "BRL",
  fxSrc: store("fxSrc") || "com",
  range: 365,
  prefs: {},
  cb: {},
  flags: {},
  ops: [],
  pieMode: store("pie") || "ativo",
  hide: store("hide") === "1",
  filters: loadFilters(),
  sort: { k: "value", d: -1 },
};
function loadFilters() {
  const def = { q: "", locals: [], net: "", res: "", min: "", minq: "", spam: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem("carteira.filtros") || "{}") }; } catch { return def; }
}
function saveFilters() {
  try { localStorage.setItem("carteira.filtros", JSON.stringify(S.filters)); } catch { /* */ }
}
const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDP", "USD1", "USDE", "PYUSD"]);
const NET = {
  bitcoin: "Bitcoin", cardano: "Cardano", polkadot: "Polkadot", "assethub-polkadot": "Polkadot Asset Hub",
  "eth-mainnet": "Ethereum", "bnb-mainnet": "BSC", "matic-mainnet": "Polygon", "arb-mainnet": "Arbitrum",
  "opt-mainnet": "Optimism", "base-mainnet": "Base", "avax-mainnet": "Avalanche", "linea-mainnet": "Linea",
  "zksync-mainnet": "zkSync", "scroll-mainnet": "Scroll",
  "binance-spot": "Binance Spot", "binance-funding": "Binance Funding", "binance-earn": "Binance Earn", binance: "Binance",
};
const EVM_NETS = ["eth-mainnet", "bnb-mainnet", "matic-mainnet", "arb-mainnet", "base-mainnet", "opt-mainnet", "avax-mainnet", "linea-mainnet", "zksync-mainnet", "scroll-mainnet"];
const EVM_DEFAULT = ["eth-mainnet", "bnb-mainnet", "matic-mainnet", "arb-mainnet", "base-mainnet", "opt-mainnet"];
const KIND = { evm: "EVM", btc: "Bitcoin", cardano: "Cardano", polkadot: "Polkadot", binance: "Binance" };

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem("carteira." + k);
    localStorage.setItem("carteira." + k, v);
  } catch { /* sem armazenamento local */ }
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------------ formatação
const fBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fUSD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const MASK = "•••••";
function money(v, ccy = S.ccy) {
  if (v == null || !isFinite(v)) return "—";
  if (S.hide) return (ccy === "BRL" ? "R$ " : "US$ ") + MASK;
  return (ccy === "BRL" ? fBRL : fUSD).format(v);
}
function price(v, ccy) {
  if (v == null || !isFinite(v)) return "—";
  const d = v >= 1000 ? 2 : v >= 1 ? 2 : v >= 0.01 ? 4 : 8;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: ccy, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
function qty(v) {
  if (v == null) return "—";
  if (S.hide) return MASK;
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : 8;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(v);
}
function pct(v) {
  if (v == null || !isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2).replace(".", ",")}%`;
}
const otherCcy = () => (S.ccy === "BRL" ? "USD" : "BRL");
// valor em US$ mostrado nas duas moedas (principal em cima, a outra embaixo)
function dualUsd(usd, fmt = money, signed = false) {
  const brl = usd != null && rate() ? usd * rate() : null;
  const [a, b] = S.ccy === "BRL" ? [brl, usd] : [usd, brl];
  const c = signed ? cls(usd) : "";
  return `<b class="${c}">${fmt(a, S.ccy)}</b><div class="alt ${c}">${fmt(b, otherCcy())}</div>`;
}
function dualBrl(brl, fmt = money, signed = false) {
  const usd = brl != null && rate() ? brl / rate() : null;
  const [a, b] = S.ccy === "BRL" ? [brl, usd] : [usd, brl];
  const c = signed ? cls(brl) : "";
  return `<b class="${c}">${fmt(a, S.ccy)}</b><div class="alt ${c}">${fmt(b, otherCcy())}</div>`;
}
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
function ago(ts) {
  if (!ts) return "";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function color(sym) {
  let h = 0;
  for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}
// ícones: logo do CoinGecko (cripto) ou do brapi (B3); se não houver, bolinha com as letras
const fallbackIco = (sym) => `<span class="ico" style="background:${color(sym)}">${esc(sym.slice(0, 4))}</span>`;
function logoUrl(sym, kind) {
  if (kind === "b3") return /^[A-Z0-9]{4,7}$/.test(sym) ? `https://icons.brapi.dev/icons/${sym.toUpperCase()}.svg` : null;
  if (kind === "rf") return null;
  return CGM.map[sym]?.image || null;
}
function icon(sym, kind, flag) {
  const url = flag ? null : logoUrl(sym, kind);
  if (!url) return fallbackIco(sym);
  return `<img class="ico img" src="${esc(url)}" alt="" loading="lazy" data-sym="${esc(sym)}" onerror="icoFail(this)" />`;
}
window.icoFail = (img) => {
  const sym = img.dataset.sym || "?";
  const span = document.createElement("span");
  span.className = "ico";
  span.style.background = color(sym);
  span.textContent = sym.slice(0, 4);
  img.replaceWith(span);
};

// ------------------------------------------------------------------ CoinGecko (logos e informações)
const CG = "https://api.coingecko.com/api/v3";
const CGM = (() => {
  try { return JSON.parse(localStorage.getItem("carteira.cgm") || "") || { map: {} }; } catch { return { map: {} }; }
})();
const saveCGM = () => { try { localStorage.setItem("carteira.cgm", JSON.stringify(CGM)); } catch { /* */ } };
let cgBusy = false;
async function loadMarkets() {
  if (cgBusy) return;
  const syms = new Set();
  for (const h of S.holdings) if (!holdingFlag(h) && /^[A-Z0-9]{2,10}$/.test(h.symbol)) syms.add(h.symbol);
  const stale = [...syms].filter((x) => !CGM.map[x] || Date.now() - (CGM.map[x].at || 0) > (CGM.map[x].id ? 15 : 24 * 60) * 60e3);
  if (!stale.length) return;
  cgBusy = true;
  try {
    for (let i = 0; i < stale.length; i += 40) {
      const part = stale.slice(i, i + 40); // CoinGecko aceita até 50 símbolos por consulta
      const r = await fetch(`${CG}/coins/markets?vs_currency=usd&include_tokens=top&per_page=250&symbols=${part.map((x) => x.toLowerCase()).join(",")}`);
      if (!r.ok) break;
      const list = await r.json();
      const got = new Set();
      for (const x of list) {
        const k = String(x.symbol || "").toUpperCase();
        if (got.has(k)) continue; // fica com o de maior valor de mercado
        got.add(k);
        CGM.map[k] = {
          at: Date.now(), id: x.id, name: x.name, image: String(x.image || "").replace("/large/", "/small/"), rank: x.market_cap_rank,
          mcap: x.market_cap, fdv: x.fully_diluted_valuation, vol: x.total_volume, circ: x.circulating_supply, total: x.total_supply, max: x.max_supply,
          ath: x.ath, athDate: x.ath_date, athPct: x.ath_change_percentage, atl: x.atl, atlDate: x.atl_date, atlPct: x.atl_change_percentage,
          high24: x.high_24h, low24: x.low_24h,
        };
      }
      for (const k of part) if (!got.has(k)) CGM.map[k] = { at: Date.now(), id: null };
    }
    saveCGM();
    renderPainel();
    renderMovs();
  } catch { /* sem internet ou CoinGecko fora: fica com as letras */ }
  cgBusy = false;
}

// ------------------------------------------------------------------ câmbio
function rate() {
  const r = S.fxSrc === "usdt" ? S.fx.usdt ?? S.fx.com : S.fx.com ?? S.fx.usdt;
  return r || null;
}
const toCcy = (usd) => (usd == null ? null : S.ccy === "USD" ? usd : rate() ? usd * rate() : null);
const brlToCcy = (brl) => (brl == null ? null : S.ccy === "BRL" ? brl : rate() ? brl / rate() : null);

// ------------------------------------------------------------------ cálculo
function livePrice(sym, fallback) {
  if (STABLE.has(sym)) return 1;
  return S.live[sym]?.p ?? fallback ?? null;
}
function change24(sym) {
  const l = S.live[sym];
  return l && l.o ? (l.p - l.o) / l.o : null;
}
const KIND_LOCAL = { b3: "B3", renda_fixa: "Renda fixa", outro: "Outros" };
// spam/suspeito: sua marcação manual vale mais que a automática
function holdingFlag(h) {
  if (h.contract) {
    const f = S.flags[`${h.network}:${h.contract.toLowerCase()}`];
    if (f === "spam") return "spam";
    if (f === "ok") return null;
  }
  return h.flag || null;
}
function cryptoRows(useFilters = false) {
  const f = S.filters;
  const map = new Map();
  for (const h of S.holdings) {
    const flag = holdingFlag(h);
    if (flag && !(useFilters && f.spam)) continue;
    if (useFilters && f.locals.length && !f.locals.includes(h.source)) continue;
    if (useFilters && f.net && h.network !== f.net) continue;
    const k = h.symbol;
    const r = map.get(k) || { sym: k, name: h.name, amount: 0, priceSync: null, parts: [], hasPrice: false };
    r.amount += Number(h.amount);
    if (h.price_usd != null) {
      r.priceSync = Number(h.price_usd);
      r.hasPrice = true;
    }
    if (!r.name && h.name) r.name = h.name;
    if (flag) r.flag = flag;
    r.parts.push(h);
    map.set(k, r);
  }
  return [...map.values()].map((r) => {
    const p = livePrice(r.sym, r.priceSync);
    const st = S.settings[r.sym] || {};
    let pnlUsd = null, costUsd = null;
    if (st.avg_cost_usd && p != null) {
      costUsd = st.avg_cost_usd * r.amount;
      pnlUsd = p * r.amount - costUsd;
    } else if (st.avg_cost_brl && p != null && rate()) {
      costUsd = (st.avg_cost_brl * r.amount) / rate();
      pnlUsd = p * r.amount - costUsd;
    }
    const cb = S.cb[r.sym];
    let avgSrc = st.avg_cost_usd || st.avg_cost_brl ? "manual" : null;
    if (!avgSrc && cb && Number(cb.qty) > 0 && p != null) {
      costUsd = (Number(cb.cost_usd) / Number(cb.qty)) * r.amount;
      pnlUsd = p * r.amount - costUsd;
      avgSrc = "binance";
    }
    return { ...r, price: p, value: p != null ? p * r.amount : null, ch: change24(r.sym), hidden: !!st.hidden, st, pnlUsd, costUsd, avgSrc, cb };
  });
}
function manualRows() {
  return S.manual.map((a) => {
    let px = null, prev = null, valueBrl = null;
    const toBrl = (v) => (v == null ? null : a.currency === "USD" ? (rate() ? v * rate() : null) : v);
    if (a.kind === "b3") {
      const q = S.b3[a.symbol.toUpperCase()];
      px = q?.price ?? null;
      prev = q?.prev ?? null;
      valueBrl = toBrl((px ?? Number(a.avg_price || 0)) * Number(a.quantity));
    } else {
      valueBrl = toBrl(a.current_value != null ? Number(a.current_value) : Number(a.avg_price || 0) * Number(a.quantity));
    }
    const costBrl = a.avg_price != null ? toBrl(Number(a.avg_price) * Number(a.quantity)) : null;
    const pnlBrl = costBrl != null && valueBrl != null ? valueBrl - costBrl : null;
    return { ...a, local: KIND_LOCAL[a.kind], px, prev, valueBrl, costBrl, pnlBrl, ch: px && prev ? (px - prev) / prev : null };
  });
}
// filtros combinados (todos precisam bater)
function passCommon({ sym, name, amount, valueCcy, pnl, ch }) {
  const f = S.filters;
  if (f.q) {
    const q = f.q.trim().toUpperCase();
    if (!sym.toUpperCase().includes(q) && !(name || "").toUpperCase().includes(q)) return false;
  }
  if (f.res === "lucro" && !(pnl > 0)) return false;
  if (f.res === "prejuizo" && !(pnl < 0)) return false;
  if (f.res === "sem" && pnl != null) return false;
  if (f.res === "subindo" && !(ch > 0)) return false;
  if (f.res === "caindo" && !(ch < 0)) return false;
  if (f.min !== "" && !(valueCcy >= Number(f.min))) return false;
  if (f.minq !== "" && !(amount >= Number(f.minq))) return false;
  return true;
}
function filteredCrypto() {
  return cryptoRows(true).filter((r) =>
    r.parts.length &&
    (S.filters.spam || r.hasPrice || S.live[r.sym]) &&
    passCommon({ sym: r.sym, name: r.name, amount: r.amount, valueCcy: toCcy(r.value), pnl: r.pnlUsd, ch: r.ch }));
}
function filteredManual() {
  const f = S.filters;
  return manualRows().filter((a) => {
    if (f.net) return false; // redes valem só para cripto
    if (f.locals.length && !f.locals.includes(a.local)) return false;
    return passCommon({ sym: a.symbol, name: a.name, amount: Number(a.quantity), valueCcy: brlToCcy(a.valueBrl), pnl: a.pnlBrl, ch: a.ch });
  });
}
function sortRows(rows, get) {
  const { k, d } = S.sort;
  return rows.sort((a, b) => {
    const x = get(a, k), y = get(b, k);
    if (typeof x === "string" || typeof y === "string") return d * String(x ?? "").localeCompare(String(y ?? ""));
    return d * ((x ?? -Infinity) - (y ?? -Infinity));
  });
}
function totals() {
  const cr = cryptoRows().filter((r) => !r.hidden);
  const cryptoUsd = cr.reduce((s, r) => s + (r.value || 0), 0);
  const ch24Usd = cr.reduce((s, r) => s + (r.value && r.ch != null ? r.value - r.value / (1 + r.ch) : 0), 0);
  const mr = manualRows();
  const by = (k) => mr.filter((m) => m.kind === k).reduce((s, m) => s + (m.valueBrl || 0), 0);
  const b3 = by("b3"), rf = by("renda_fixa"), out = by("outro");
  const b3Ch = mr.filter((m) => m.kind === "b3" && m.ch != null).reduce((s, m) => s + (m.valueBrl - m.valueBrl / (1 + m.ch)), 0);
  const r = rate();
  const totalBrl = r ? cryptoUsd * r + b3 + rf + out : null;
  const totalUsd = r ? cryptoUsd + (b3 + rf + out) / r : null;
  const chBrl = r ? ch24Usd * r + b3Ch : null;
  return { cryptoUsd, b3, rf, out, totalBrl, totalUsd, chBrl };
}

// ------------------------------------------------------------------ dados
async function loadAll() {
  const [w, h, m, st, tx, sn, pf, cb, fl, op] = await Promise.all([
    sb.from("wallets").select("*").order("created_at"),
    sb.from("holdings").select("*"),
    sb.from("manual_assets").select("*").order("created_at"),
    sb.from("asset_settings").select("*"),
    sb.from("transactions").select("*").order("ts", { ascending: false }).limit(3000),
    sb.from("snapshots").select("taken_at,total_usd,total_brl,usd_brl").order("taken_at").limit(5000),
    sb.from("user_prefs").select("*").maybeSingle(),
    sb.from("cost_basis").select("*"),
    sb.from("token_flags").select("*"),
    sb.from("manual_ops").select("*").order("op_date"),
  ]);
  for (const r of [w, h, m, st, tx, sn]) if (r.error) throw r.error;
  S.wallets = w.data;
  S.holdings = h.data;
  S.manual = m.data;
  S.settings = Object.fromEntries(st.data.map((s) => [s.symbol, s]));
  S.txs = tx.data;
  S.snaps = sn.data;
  S.prefs = pf.data || {};
  S.cb = Object.fromEntries((cb.data || []).map((c) => [c.symbol, c]));
  S.ops = op.data || [];
  S.flags = Object.fromEntries((fl.data || []).map((x) => [`${x.network}:${x.contract.toLowerCase()}`, x.status]));
  const last = S.holdings.reduce((m, x) => (x.updated_at > m ? x.updated_at : m), "");
  $("#last-sync").textContent = last ? `Saldos atualizados ${ago(last)}` : "Ainda não sincronizado";
  connectLive();
  await loadQuotes();
  renderAll();
  loadMarkets();
}

async function loadQuotes() {
  const syms = S.manual.filter((a) => a.kind === "b3").map((a) => a.symbol.toUpperCase());
  try {
    const { data, error } = await sb.functions.invoke("quotes", { body: { symbols: syms }, region: REGION });
    if (error) throw error;
    if (data.fx?.price) {
      S.fx.com = data.fx.price;
      S.fx.comPrev = data.fx.prev;
    }
    S.b3 = data.b3 || {};
  } catch (e) {
    console.warn("cotações", e);
  }
  renderFx();
  if (S.user && S.holdings) renderPie();
}

// ------------------------------------------------------------------ preços ao vivo (Binance)
let ws, wsSyms = "", wsHost = 0;
function connectLive() {
  const syms = new Set(["BTC", "ETH"]);
  for (const h of S.holdings) if (!STABLE.has(h.symbol) && h.price_usd != null) syms.add(h.symbol);
  const streams = [...syms].map((s) => `${s.toLowerCase()}usdt@miniTicker`);
  streams.push("usdtbrl@miniTicker");
  const key = streams.join("/");
  if (key === wsSyms && ws && ws.readyState <= 1) return;
  wsSyms = key;
  try { ws?.close(); } catch { /* */ }
  // data-stream.binance.vision é o endereço só de cotações (funciona em redes que bloqueiam o principal)
  const hosts = ["wss://data-stream.binance.vision", "wss://stream.binance.com:9443"];
  ws = new WebSocket(`${hosts[wsHost % hosts.length]}/stream?streams=${key}`);
  let got = false;
  const sock = ws;
  setTimeout(() => { if (!got && sock === ws) { wsHost++; wsSyms = ""; try { sock.close(); } catch { /* */ } } }, 8000);
  ws.onmessage = (ev) => {
    got = true;
    const d = JSON.parse(ev.data).data;
    if (!d?.s) return;
    if (d.s === "USDTBRL") {
      S.fx.usdt = Number(d.c);
      S.fx.usdtOpen = Number(d.o);
      return;
    }
    const sym = d.s.replace(/USDT$/, "");
    const prev = S.live[sym]?.p;
    S.live[sym] = { p: Number(d.c), o: Number(d.o), dir: prev == null ? 0 : Math.sign(Number(d.c) - prev) };
    dirty = true;
  };
  ws.onclose = () => setTimeout(() => { wsSyms = ""; if (S.user) connectLive(); }, 3000);
}
let dirty = true;
setInterval(() => {
  if (!S.user) return;
  renderFx();
  if (dirty || S.fxSrc === "usdt") {
    dirty = false;
    renderPainel();
  }
}, 1000);
setInterval(() => S.user && loadQuotes(), 30_000);

// ------------------------------------------------------------------ render
function renderAll() {
  renderPainel();
  renderChart();
  renderMovs();
  renderCadastros();
  renderTape();
  renderWatchlist();
  renderPie();
}

function renderFx() {
  const r = S.fx;
  $("#fx-com").textContent = r.com ? price(r.com, "BRL") : "—";
  $("#fx-usdt").textContent = r.usdt ? price(r.usdt, "BRL") : "—";
  $("#fx-com").className = S.fxSrc === "com" ? "sel" : "";
  $("#fx-usdt").className = S.fxSrc === "usdt" ? "sel" : "";
  $("#fx").title = `Conversão usando ${S.fxSrc === "com" ? "o dólar comercial" : "o USDT/BRL da Binance"}. Clique para trocar.`;
}

function renderPainel() {
  const t = totals();
  const main = S.ccy === "BRL" ? t.totalBrl : t.totalUsd;
  $("#total").textContent = money(main);
  $("#total-alt").textContent = S.ccy === "BRL" ? money(t.totalUsd, "USD") : money(t.totalBrl, "BRL");
  const ch = t.chBrl != null ? brlToCcy(t.chBrl) : null;
  const base = main != null && ch != null ? main - ch : null;
  const c24 = $("#change24");
  c24.className = "chip " + cls(ch);
  c24.textContent = ch != null && base ? `${money(ch)} (${pct(ch / base)}) em 24h` : "";

  // alocação
  const mainBrl = t.totalBrl;
  const parts = [
    ["Cripto", rate() ? t.cryptoUsd * rate() : null, "#f7931a"],
    ["B3", t.b3, "#0ea5e9"],
    ["Renda fixa", t.rf, "#10b981"],
  ];
  if (t.out) parts.push(["Outros", t.out, "#a78bfa"]);
  $("#alloc").innerHTML = parts
    .map(([n, vBrl, c]) => {
      const p = mainBrl ? (vBrl || 0) / mainBrl : 0;
      return `<div class="stat"><div class="muted">${n} <span class="small">${mainBrl ? (p * 100).toFixed(1).replace(".", ",") + "%" : ""}</span></div><div class="v">${dualBrl(vBrl)}</div><div class="bar"><i style="width:${(p * 100).toFixed(1)}%;background:${c}"></i></div></div>`;
    })
    .join("");

  renderFilters();
  const arrow = (k) => (S.sort.k === k ? (S.sort.d > 0 ? " ▲" : " ▼") : "");
  const th = (k, label, extra = "") => `<th data-k="${k}" class="sortable ${extra}">${label}${arrow(k)}</th>`;

  // tabela cripto
  const rows = sortRows(filteredCrypto(), (r, k) => ({ sym: r.sym, price: r.price, ch: r.ch, amount: r.amount, value: r.value, pnl: r.pnlUsd })[k]);
  const totalC = cryptoRows().filter((r) => !r.hidden).reduce((s, r) => s + (r.value || 0), 0);
  const head = `<tr>${th("sym", "Ativo")}${th("price", "Preço")}<th class="hide-sm">Preço médio</th>${th("ch", "24h")}${th("amount", "Quantidade", "hide-sm")}${th("value", "Valor")}<th class="hide-sm">% cart.</th>${th("pnl", "Resultado", "hide-sm")}</tr>`;
  const body = rows
    .map((r) => {
      const locs = [...new Set(r.parts.map((p) => `${p.source} · ${NET[p.network] || p.network}`))];
      const wallets = [...new Set(r.parts.map((p) => p.source))];
      const nets = locs.length === 1 ? locs[0] : `${wallets[0]}${locs.length > 1 ? ` + ${locs.length - 1} ${locs.length - 1 === 1 ? "local" : "locais"}` : ""}`;
      const netsTitle = locs.join("\n");
      const live = S.live[r.sym];
      const flash = live?.dir > 0 ? "flash-up" : live?.dir < 0 ? "flash-down" : "";
      if (live) live.dir = 0;
      return `<tr class="click ${r.hidden ? "dim" : ""}" data-sym="${esc(r.sym)}">
        <td><div class="asset">${icon(r.sym, "crypto", r.flag)}<div><div class="sym">${esc(r.sym)}${r.flag ? ` <span class="badge warn">${r.flag}</span>` : ""}</div><div class="nets-small locs" title="${esc(netsTitle)}">${esc(nets)}</div></div></div></td>
        <td><span class="price ${flash}">${dualUsd(r.price, price)}</span></td>
        <td class="hide-sm">${r.costUsd && r.amount ? `<span class="price">${dualUsd(r.costUsd / r.amount, price)}</span>` : '<span class="muted small">—</span>'}</td>
        <td><span class="pct ${cls(r.ch)}">${pct(r.ch)}</span></td>
        <td class="hide-sm">${qty(r.amount)}</td>
        <td>${dualUsd(r.value)}</td>
        <td class="hide-sm">${totalC && r.value && !r.hidden ? ((r.value / totalC) * 100).toFixed(1).replace(".", ",") + "%" : ""}</td>
        <td class="hide-sm">${r.pnlUsd != null ? `${dualUsd(r.pnlUsd, money, true)}<div class="nets-small ${cls(r.pnlUsd)}">${r.costUsd ? pct(r.pnlUsd / r.costUsd) : ""}${r.avgSrc === "binance" ? ' <span class="muted" title="Preço médio calculado pelo histórico da Binance">· Binance</span>' : ""}</div>` : '<span class="muted small">sem preço médio</span>'}</td>
      </tr>`;
    })
    .join("");
  const emptyMsg = S.holdings.length
    ? "Nenhum ativo com esses filtros."
    : "Nenhum ativo ainda. Cadastre suas carteiras em <b>Cadastros</b> e clique em <b>Atualizar saldos</b>.";
  const flagged = S.holdings.filter((h) => holdingFlag(h));
  const nSus = flagged.filter((h) => holdingFlag(h) === "suspeito");
  $("#spam-note").innerHTML = flagged.length
    ? `🛡️ ${nSus.length ? `<b>${nSus.length} token(s) suspeito(s)</b> (${esc(nSus.map((h) => h.symbol).join(", "))}) e ` : ""}${flagged.length - nSus.length} token(s) de spam estão fora do total. ${S.filters.spam ? "" : '<a href="#" id="show-flagged">Mostrar para revisar</a>'}`
    : "";
  $("#spam-note").classList.toggle("hidden", !flagged.length);
  $("#crypto-table").innerHTML = head + (body || `<tr><td colspan="8" class="empty">${emptyMsg}</td></tr>`);

  // tabela manual
  const mr = sortRows(filteredManual(), (a, k) => ({ sym: a.symbol, price: a.px, ch: a.ch, amount: Number(a.quantity), value: a.valueBrl, pnl: a.pnlBrl })[k]);
  $("#manual-table").innerHTML =
    `<tr>${th("sym", "Ativo")}${th("price", "Preço")}${th("ch", "Dia")}${th("amount", "Quantidade", "hide-sm")}${th("value", "Valor")}${th("pnl", "Resultado", "hide-sm")}</tr>` +
    (mr
      .map((a) => `<tr class="click" data-mid="${a.id}">
          <td><div class="asset">${icon(a.symbol, a.kind === "b3" ? "b3" : "rf")}<div><div class="sym">${esc(a.symbol)}</div><div class="nets-small">${esc(a.name || a.local)}</div></div></div></td>
          <td><span class="price">${a.kind === "b3" ? dualBrl(a.px, price) : "—"}</span></td>
          <td><span class="pct ${cls(a.ch)}">${pct(a.ch)}</span></td>
          <td class="hide-sm">${a.kind === "b3" ? qty(Number(a.quantity)) : ""}</td>
          <td>${dualBrl(a.valueBrl)}</td>
          <td class="hide-sm">${a.pnlBrl != null ? `${dualBrl(a.pnlBrl, money, true)}<div class="nets-small ${cls(a.pnlBrl)}">${a.costBrl ? pct(a.pnlBrl / a.costBrl) : ""}${a.start_date ? ` · desde ${fmtDate(a.start_date)}` : ""}</div>` : ""}</td>
        </tr>`)
      .join("") || `<tr><td colspan="6" class="empty">${S.manual.length ? "Nenhum ativo com esses filtros." : "Cadastre ações, FIIs e renda fixa em <b>Cadastros</b>."}</td></tr>`);

  // resumo do que está filtrado
  const fUsd = rows.filter((r) => !r.hidden).reduce((s, r) => s + (r.value || 0), 0) + (rate() ? mr.reduce((s, a) => s + (a.valueBrl || 0), 0) / rate() : 0);
  const active = filtersActive();
  $("#f-summary").innerHTML = active
    ? `Filtrado: <b>${rows.length + mr.length}</b> ativo(s) · <b>${money(toCcy(fUsd))}</b> <span class="muted">${money(S.ccy === "BRL" ? fUsd : rate() ? fUsd * rate() : null, otherCcy())}</span>`
    : `<span class="muted">${rows.length + mr.length} ativo(s)</span>`;
  $("#f-clear").classList.toggle("hidden", !active);
}

function filtersActive() {
  const f = S.filters;
  return !!(f.q || f.locals.length || f.net || f.res || f.min !== "" || f.minq !== "");
}
let filtersBuilt = "";
function renderFilters() {
  const f = S.filters;
  const locals = [...new Set([...S.wallets.filter((w) => w.active).map((w) => w.label), ...S.manual.map((a) => KIND_LOCAL[a.kind])])];
  const nets = [...new Set(S.holdings.map((h) => h.network))];
  const key = JSON.stringify([locals, nets, f]);
  if (key === filtersBuilt) return;
  filtersBuilt = key;
  $("#f-locals").innerHTML = locals.map((l) => `<button type="button" class="chip-btn ${f.locals.includes(l) ? "on" : ""}" data-local="${esc(l)}">${esc(l)}</button>`).join("");
  const sel = $("#f-net");
  sel.innerHTML = `<option value="">Todas as redes</option>` + nets.map((n) => `<option value="${esc(n)}">${esc(NET[n] || n)}</option>`).join("");
  sel.value = f.net;
  if (document.activeElement !== $("#f-q")) $("#f-q").value = f.q;
  $("#f-res").value = f.res;
  if (document.activeElement !== $("#f-min")) $("#f-min").value = f.min;
  if (document.activeElement !== $("#f-minq")) $("#f-minq").value = f.minq;
  $("#show-spam").checked = !!f.spam;
  $("#f-min-label").textContent = `Valor mínimo (${S.ccy === "BRL" ? "R$" : "US$"})`;
}

// composição da carteira (pizza): 7 maiores + "Outros"
const PIE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const PIE_OTHER = "#5b6675";
function pieData() {
  const r = rate();
  if (!r) return [];
  const m = new Map();
  const addTo = (k, brl) => brl > 0 && m.set(k, (m.get(k) || 0) + brl);
  if (S.pieMode === "ativo") {
    for (const c of cryptoRows()) if (!c.hidden) addTo(c.sym, (c.value || 0) * r);
    for (const a of manualRows()) addTo(a.symbol, a.valueBrl || 0);
  } else {
    for (const h of S.holdings) {
      if (S.settings[h.symbol]?.hidden || holdingFlag(h)) continue;
      const p = livePrice(h.symbol, h.price_usd != null ? Number(h.price_usd) : null);
      if (p != null) addTo(h.source, p * Number(h.amount) * r);
    }
    for (const a of manualRows()) addTo(a.local, a.valueBrl || 0);
  }
  const all = [...m.entries()].map(([name, brl]) => ({ name, brl })).sort((a, b) => b.brl - a.brl);
  const top = all.slice(0, 7).map((x, i) => ({ ...x, color: PIE[i] }));
  const rest = all.slice(7);
  if (rest.length) top.push({ name: `Outros (${rest.length})`, brl: rest.reduce((s, x) => s + x.brl, 0), color: PIE_OTHER, other: rest.map((x) => x.name) });
  return top;
}
function renderPie() {
  const data = pieData();
  const total = data.reduce((s, d) => s + d.brl, 0);
  document.querySelectorAll("#pie-mode button").forEach((b) => b.classList.toggle("active", b.dataset.m === S.pieMode));
  if (!total) {
    $("#pie").innerHTML = "";
    $("#pie-legend").innerHTML = '<p class="muted">Sem dados ainda.</p>';
    return;
  }
  const R = 100, r0 = 64, C = 110;
  const pt = (a, rad) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  let a = 0;
  const paths = data.map((d, i) => {
    const frac = d.brl / total;
    const a1 = a + frac * Math.PI * 2;
    let path;
    if (frac > 0.9999) {
      path = `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} Z M ${C} ${C - r0} A ${r0} ${r0} 0 1 0 ${C - 0.01} ${C - r0} Z`;
    } else {
      const big = a1 - a > Math.PI ? 1 : 0;
      const [x0, y0] = pt(a, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r0), [x3, y3] = pt(a, r0);
      path = `M ${x0} ${y0} A ${R} ${R} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${big} 0 ${x3} ${y3} Z`;
    }
    a = a1;
    const tip = `${d.name}: ${(frac * 100).toFixed(1).replace(".", ",")}%${S.hide ? "" : " · " + money(S.ccy === "BRL" ? d.brl : d.brl / rate())}${d.other ? "\n" + d.other.join(", ") : ""}`;
    return `<path data-i="${i}" d="${path}" fill="${d.color}" stroke="var(--panel)" stroke-width="2" fill-rule="evenodd"><title>${esc(tip)}</title></path>`;
  });
  const mainTotal = S.ccy === "BRL" ? total : total / rate();
  $("#pie").innerHTML = `<svg viewBox="0 0 220 220" role="img" aria-label="Composição da carteira">${paths.join("")}
    <text x="110" y="108" text-anchor="middle" class="pie-center-v">${esc(money(mainTotal))}</text>
    <text x="110" y="126" text-anchor="middle" class="pie-center-l">${S.pieMode === "ativo" ? "por ativo" : "por onde está"}</text></svg>`;
  $("#pie-legend").innerHTML = data
    .map((d, i) => `<div class="pl-row" data-i="${i}" title="${esc(d.other ? d.other.join(", ") : d.name)}"><i style="background:${d.color}"></i><span>${esc(d.name)}</span><span class="pc">${((d.brl / total) * 100).toFixed(1).replace(".", ",")}%</span><span class="vv">${dualBrl(d.brl)}</span></div>`)
    .join("");
}
function pieHover(i) {
  $("#pie").classList.toggle("hovering", i != null);
  document.querySelectorAll("#pie path").forEach((p) => p.classList.toggle("on", p.dataset.i === String(i)));
  document.querySelectorAll(".pl-row").forEach((p) => p.classList.toggle("on", p.dataset.i === String(i)));
}

const isSpamSym = (sym) => {
  const u = String(sym || "").toUpperCase();
  return S.holdings.some((h) => h.symbol === u && holdingFlag(h) === "spam") || /[\s#$:/]|\.(io|com|org|net|app|xyz)$/i.test(u) ? "spam" : null;
};
// trocas on-chain: na mesma transação saiu um token e entrou outro
let swapIdx = null, swapIdxLen = -1;
function swapPeer(t) {
  if (t.network === "binance" || !t.tx_hash) return null;
  if (swapIdxLen !== S.txs.length) {
    swapIdx = new Map();
    for (const x of S.txs) {
      const k = `${x.network}|${x.tx_hash}`;
      (swapIdx.get(k) || swapIdx.set(k, []).get(k)).push(x);
    }
    swapIdxLen = S.txs.length;
  }
  const group = swapIdx.get(`${t.network}|${t.tx_hash}`) || [];
  const want = t.direction === "in" ? "out" : t.direction === "out" ? "in" : null;
  if (!want) return null;
  const peers = group.filter((x) => x.direction === want && (x.symbol || "").toUpperCase() !== (t.symbol || "").toUpperCase());
  if (!peers.length) return null;
  // se saiu ETH e entraram 2 tokens, usa o de maior quantidade como contraparte
  return peers.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
}

// movimentações de um ativo (inclui quando ele foi usado para pagar outra compra)
function assetMovs(sym) {
  const out = [];
  for (const t of S.txs) {
    const base = (t.symbol || "").toUpperCase(), quote = (t.quote_asset || "").toUpperCase();
    const peer = base === sym ? swapPeer(t) : null;
    if (peer) {
      const n = Number(t.amount), m = Number(peer.amount);
      out.push({ t, dir: t.direction === "in" ? "buy" : "sell", amount: n, unit: n ? m / n : null, unitAsset: (peer.symbol || "").toUpperCase(), total: m, swapped: true,
        desc: t.direction === "in" ? `troca: −${qty(m)} ${peer.symbol}` : `troca: +${qty(m)} ${peer.symbol}` });
    } else if (base === sym) {
      out.push({ t, dir: t.direction, amount: Number(t.amount), unit: t.quote_amount && t.amount ? Number(t.quote_amount) / Number(t.amount) : null, unitAsset: quote || null, total: t.quote_amount != null ? Number(t.quote_amount) : null, desc: t.quote_asset ? t.counterparty : t.counterparty });
    } else if (quote === sym && (t.direction === "buy" || t.direction === "sell")) {
      out.push({ t, dir: t.direction === "buy" ? "sell" : "buy", amount: Number(t.quote_amount), unit: Number(t.amount) / Number(t.quote_amount), unitAsset: base, total: Number(t.amount), desc: t.direction === "buy" ? `usado para comprar ${base}` : `recebido pela venda de ${base}` , swapped: true });
    }
  }
  return out;
}
const shortAddr = (t) => (t || "").replace(/0x[0-9a-fA-F]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{30,}|bc1[0-9a-z]{30,}|addr1[0-9a-z]{40,}/g, (m) => m.slice(0, 8) + "…" + m.slice(-6));
function unitFmt(v, asset) {
  if (v == null || !isFinite(v)) return "—";
  if (STABLE.has(asset)) return price(v, "USD");
  if (asset === "BRL") return price(v, "BRL");
  return `${new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 6 }).format(v)} ${asset}`;
}
function renderAssetMovs(sym) {
  const list = assetMovs(sym);
  const dname = { in: "Entrada", out: "Saída", self: "Interna", trade: "Troca", buy: "Compra", sell: "Venda" };
  const sum = (d) => list.filter((x) => x.dir === d).reduce((s, x) => s + (x.amount || 0), 0);
  const cnt = (d) => list.filter((x) => x.dir === d).length;
  $("#d-tabs").querySelector('[data-t="movs"]').textContent = `Movimentações (${list.length})`;
  $("#d-movs").innerHTML = `
    <div class="d-sum">
      <div class="stat"><div class="muted small">Comprado (${cnt("buy")})</div><div class="v up">${qty(sum("buy"))}</div></div>
      <div class="stat"><div class="muted small">Vendido / usado (${cnt("sell")})</div><div class="v down">${qty(sum("sell"))}</div></div>
      <div class="stat"><div class="muted small">Entradas (${cnt("in")})</div><div class="v">${qty(sum("in"))}</div></div>
      <div class="stat"><div class="muted small">Saídas (${cnt("out")})</div><div class="v">${qty(sum("out"))}</div></div>
    </div>
    <div class="table-wrap"><table class="assets">
      <tr><th>Data</th><th>Tipo</th><th>Quantidade</th><th>Preço unitário</th><th class="hide-sm">Total</th><th class="hide-sm">Onde / detalhe</th><th></th></tr>
      ${list.map((x) => `<tr>
        <td>${x.t.ts ? new Date(x.t.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
        <td><span class="${x.dir === "buy" || x.dir === "in" ? "up" : x.dir === "sell" || x.dir === "out" ? "down" : ""}">${dname[x.dir] || x.dir}</span></td>
        <td>${qty(x.amount)}</td>
        <td>${x.unitAsset ? unitFmt(x.unit, x.unitAsset) : "—"}</td>
        <td class="hide-sm">${x.total != null && x.unitAsset ? (S.hide ? MASK : unitFmt(x.total, x.unitAsset)) : "—"}</td>
        <td class="hide-sm det"><span class="nets-small cp" title="${esc(x.t.counterparty || "")}">${esc(x.t.source)} · ${esc(NET[x.t.network] || x.t.network)}${(x.swapped ? x.desc : x.t.counterparty) ? " · " + esc(shortAddr(x.swapped ? x.desc : x.t.counterparty)) : ""}</span></td>
        <td>${x.t.url ? `<a href="${esc(x.t.url)}" target="_blank" rel="noopener">ver ↗</a>` : ""}</td>
      </tr>`).join("") || '<tr><td colspan="7" class="empty">Nenhuma movimentação registrada para este ativo.</td></tr>'}
    </table></div>`;
}
function showDetailTab(tab) {
  document.querySelectorAll("#d-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === tab));
  $("#d-chart").classList.toggle("hidden", tab !== "chart");
  $("#d-movs").classList.toggle("hidden", tab !== "movs");
  $("#d-evo").classList.toggle("hidden", tab !== "evo");
  $("#d-info").classList.toggle("hidden", tab !== "info");
  if (tab === "evo") renderEvolution();
  if (tab === "info") renderInfo();
}

// ------------------------------------------------------------------ tema claro / escuro
const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function rgba(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const chartOpts = () => ({
  layout: { background: { color: "transparent" }, textColor: cssVar("--muted"), fontFamily: "Inter" },
  grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--grid") } },
});
const areaOpts = (c) => ({ lineColor: c, topColor: rgba(c, theme() === "light" ? 0.22 : 0.32), bottomColor: rgba(c, 0) });
const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
let lastAdv = null; // último gráfico do TradingView aberto no detalhe
function advChart(tv, interval) {
  lastAdv = { tv, interval };
  tvWidget($("#d-chart"), "advanced-chart", {
    autosize: true, symbol: tv, interval, timezone: "America/Sao_Paulo", theme: theme(), style: "1",
    locale: "br", allow_symbol_change: true, hide_side_toolbar: false, calendar: false, support_host: "https://www.tradingview.com",
    backgroundColor: cssVar("--panel"), gridColor: cssVar("--grid"),
  });
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store("theme", t);
  $("#theme").innerHTML = t === "light" ? MOON : SUN;
  $("#theme").title = t === "light" ? "Tema escuro" : "Tema claro";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cssVar("--bg"));
  if (chart) { chart.applyOptions(chartOpts()); series.applyOptions(areaOpts(cssVar("--chart"))); }
  if (evoChart) evoChart.applyOptions(chartOpts());
  if (!S.user) return;
  renderTape();
  renderWatchlist();
  renderPie();
  if (lastAdv && !$("#modal").classList.contains("hidden") && $("#d-chart").innerHTML) advChart(lastAdv.tv, lastAdv.interval);
}

// gráfico do patrimônio
let chart, series;
function renderChart() {
  const el = $("#chart");
  if (!window.LightweightCharts) return;
  if (!chart) {
    chart = LightweightCharts.createChart(el, {
      ...chartOpts(),
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      localization: { locale: "pt-BR", priceFormatter: (v) => money(v) },
      autoSize: true,
    });
    series = chart.addAreaSeries({ ...areaOpts(cssVar("--chart")), lineWidth: 2 });
  }
  const since = S.range ? Date.now() - S.range * 86400e3 : 0;
  const pts = [];
  for (const s of S.snaps) {
    const t = new Date(s.taken_at).getTime();
    if (t < since) continue;
    const v = S.ccy === "BRL" ? Number(s.total_brl ?? s.total_usd * (s.usd_brl || 0)) : Number(s.total_usd);
    const time = Math.floor(t / 1000);
    if (pts.length && pts[pts.length - 1].time >= time) continue;
    pts.push({ time, value: v });
  }
  series.setData(pts);
  chart.timeScale().fitContent();
  $("#chart-empty").classList.toggle("hidden", pts.length > 1);
}

// TradingView: faixa de cotações
function tvSymbol(sym) {
  const st = S.settings[sym];
  if (st?.tv_symbol) return st.tv_symbol;
  if (sym === "USDT") return "BINANCE:USDTBRL";
  return `BINANCE:${sym}USDT`;
}
// lista do TradingView (exportada em .txt ou colada): "###Seção,BINANCE:BTCUSDT,BMFBOVESPA:PETR4"
function parseWatchlist(text) {
  const groups = [];
  let cur = { name: "Minha lista", symbols: [] };
  for (const tok of (text || "").split(/[,\n\r;]+/).map((x) => x.trim()).filter(Boolean)) {
    if (tok.startsWith("###")) {
      if (cur.symbols.length) groups.push(cur);
      cur = { name: tok.replace(/^#+/, "").trim() || "Lista", symbols: [] };
    } else if (/^[A-Z0-9_.!]+:[A-Z0-9_.!/-]+$/i.test(tok)) {
      cur.symbols.push(tok.toUpperCase());
    }
  }
  if (cur.symbols.length) groups.push(cur);
  return groups;
}
function renderWatchlist() {
  const groups = parseWatchlist(S.prefs.tv_watchlist);
  const n = groups.reduce((s, g) => s + g.symbols.length, 0);
  $("#tv-list").value = S.prefs.tv_watchlist || "";
  $("#tv-count").textContent = n ? `${n} símbolo(s) em ${groups.length} seção(ões)` : "Nenhuma lista salva.";
  $("#watch-card").classList.toggle("hidden", !n);
  if (!n) return;
  const height = Math.min(900, 80 + groups.length * 36 + n * 40);
  $("#tv-watch").style.height = height + "px";
  tvWidget($("#tv-watch"), "market-quotes", {
    width: "100%", height, isTransparent: true, colorTheme: theme(), locale: "br", showSymbolLogo: true,
    symbolsGroups: groups.map((g) => ({ name: g.name, symbols: g.symbols.map((x) => ({ name: x, displayName: x.split(":")[1] })) })),
  });
}
function renderTape() {
  const watch = parseWatchlist(S.prefs.tv_watchlist).flatMap((g) => g.symbols).map((x) => ({ proName: x, title: x.split(":")[1] }));
  const top = cryptoRows().filter((r) => r.value && !STABLE.has(r.sym)).slice(0, 8).map((r) => ({ proName: tvSymbol(r.sym), title: r.sym }));
  const b3 = S.manual.filter((a) => a.kind === "b3").map((a) => ({ proName: a.tv_symbol || `BMFBOVESPA:${a.symbol.toUpperCase()}`, title: a.symbol.toUpperCase() }));
  let symbols = [...top, { proName: "BMFBOVESPA:IBOV", title: "Ibovespa" }, ...b3, { proName: "FX_IDC:USDBRL", title: "USD/BRL" }, ...watch];
  if (!top.length && !watch.length) symbols.unshift({ proName: "BINANCE:BTCUSDT", title: "BTC" }, { proName: "BINANCE:ETHUSDT", title: "ETH" });
  const seen = new Set();
  symbols = symbols.filter((x) => !seen.has(x.proName) && seen.add(x.proName)).slice(0, 40);
  tvWidget($("#tv-tape"), "ticker-tape", { symbols, showSymbolLogo: true, isTransparent: true, displayMode: "adaptive", colorTheme: theme(), locale: "br" });
}
function tvWidget(el, name, cfg) {
  el.innerHTML = "";
  const c = document.createElement("div");
  c.className = "tradingview-widget-container";
  c.style.height = "100%";
  const w = document.createElement("div");
  w.className = "tradingview-widget-container__widget";
  w.style.height = "100%";
  c.appendChild(w);
  const s = document.createElement("script");
  s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;
  s.async = true;
  s.textContent = JSON.stringify(cfg);
  c.appendChild(s);
  el.appendChild(c);
}

// detalhe do ativo
function openAsset(sym, isB3 = false) {
  const tv = isB3 ? (S.manual.find((a) => a.symbol === sym)?.tv_symbol || `BMFBOVESPA:${sym.toUpperCase()}`) : tvSymbol(sym);
  S.detail = { kind: isB3 ? "b3" : "crypto", sym };
  const fl = !isB3 && (cryptoRows(true).find((x) => x.sym === sym)?.flag || null);
  $("#d-title").innerHTML = `${icon(sym, isB3 ? "b3" : "crypto", fl)}<span>${esc(sym)}</span>${!isB3 && CGM.map[sym]?.name ? `<span class="muted d-name">${esc(CGM.map[sym].name)}</span>` : ""}`;
  $("#d-info").innerHTML = "";
  $("#d-flag").innerHTML = "";
  $("#d-tv-link").href = `https://br.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
  $("#d-form").classList.toggle("hidden", isB3);
  if (!isB3) {
    const r = cryptoRows().find((x) => x.sym === sym) || cryptoRows(true).find((x) => x.sym === sym);
    const st = S.settings[sym] || {};
    $("#d-avg-usd").value = st.avg_cost_usd ?? "";
    $("#d-avg-brl").value = st.avg_cost_brl ?? "";
    $("#d-tv").value = st.tv_symbol ?? "";
    $("#d-hidden").checked = !!st.hidden;
    $("#d-form").dataset.sym = sym;
    const pBrl = r?.price != null && rate() ? r.price * rate() : null;
    $("#d-stats").innerHTML = [
      ["Preço (US$)", price(r?.price, "USD")],
      ["Preço (R$)", price(pBrl, "BRL")],
      ["24h", `<span class="${cls(r?.ch)}">${pct(r?.ch) || "—"}</span>`],
      ["Quantidade", qty(r?.amount)],
      ["Valor", `${money(r?.value, "USD")}<div class="small muted">${money(r?.value != null && rate() ? r.value * rate() : null, "BRL")}</div>`],
      ["Preço médio" + (r?.avgSrc === "binance" ? " (Binance)" : r?.avgSrc === "manual" ? " (manual)" : ""), r?.costUsd && r?.amount ? `${price(r.costUsd / r.amount, "USD")}<div class="sub2">${price(rate() ? (r.costUsd / r.amount) * rate() : null, "BRL")}</div>` : '<span class="muted small">não informado</span>'],
      ["Resultado", r?.pnlUsd != null ? `<span class="${cls(r.pnlUsd)}">${money(r.pnlUsd, "USD")}</span><div class="sub2 ${cls(r.pnlUsd)}">${r.costUsd ? pct(r.pnlUsd / r.costUsd) : ""}</div>` : '<span class="muted small">—</span>'],
    ].map(([k, v]) => `<div class="stat"><div class="muted small">${k}</div><div class="v">${v}</div></div>`).join("");
    const cbx = S.cb[sym];
    const avgUsd = cbx && Number(cbx.qty) ? Number(cbx.cost_usd) / Number(cbx.qty) : null;
    const avgBrl = cbx && Number(cbx.qty) ? Number(cbx.cost_brl) / Number(cbx.qty) : null;
    $("#d-avg-usd").placeholder = avgUsd ? `Binance: ${avgUsd.toFixed(avgUsd < 1 ? 6 : 2)}` : "";
    $("#d-avg-brl").placeholder = avgBrl ? `Binance: ${avgBrl.toFixed(avgBrl < 1 ? 6 : 2)}` : "";
    $("#d-cb").innerHTML = cbx
      ? `<b>Preço médio pelo histórico da Binance:</b> ${price(avgUsd, "USD")} · ${price(avgBrl, "BRL")}<br><span class="muted small">${cbx.n_ops} operação(ões) de ${new Date(cbx.first_ts).toLocaleDateString("pt-BR")} a ${new Date(cbx.last_ts).toLocaleDateString("pt-BR")}; cobre ${qty(Number(cbx.qty))} unidade(s). Moedas que chegaram por depósito (vindas de outra carteira) não entram na conta. Se preencher os campos abaixo, o seu valor manual passa a valer.</span>`
      : '<span class="muted small">Sem histórico de compra deste ativo na Binance. Você pode informar o preço médio à mão.</span>';
    const contracts = (cryptoRows(true).find((x) => x.sym === sym) || r)?.parts?.filter((p) => p.contract) || [];
    const anyFlag = contracts.some((p) => holdingFlag(p));
    $("#d-flag").innerHTML = contracts.length
      ? `<div class="flagbox ${anyFlag ? "warn" : ""}">${anyFlag ? `<b>Token marcado como ${esc(holdingFlag(contracts[0]))}.</b> Ele não entra no total.` : "Token de contrato (não é a moeda nativa da rede)."}
          <span class="muted small">Contrato: <span class="cp">${esc(contracts[0].contract)}</span> (${esc(NET[contracts[0].network] || contracts[0].network)})</span>
          <div class="row-btns"><button type="button" class="btn small danger" data-flag="spam">Marcar como spam</button><button type="button" class="btn small" data-flag="ok">É legítimo, contar no total</button></div></div>`
      : "";
    $("#d-flag").dataset.sym = sym;
    $("#d-where").innerHTML = (r?.parts || [])
      .map((p) => `<div class="where"><span>${esc(p.source)} · <span class="muted">${esc(NET[p.network] || p.network)}</span></span><span>${qty(Number(p.amount))}</span></div>`)
      .join("") || '<p class="muted">—</p>';
  } else {
    const a = manualRows().find((x) => x.symbol === sym);
    $("#d-stats").innerHTML = [
      ["Preço", price(a?.px, "BRL")],
      ["Dia", `<span class="${cls(a?.ch)}">${pct(a?.ch) || "—"}</span>`],
      ["Quantidade", qty(Number(a?.quantity))],
      ["Valor", money(a?.valueBrl, "BRL")],
    ].map(([k, v]) => `<div class="stat"><div class="muted small">${k}</div><div class="v">${v}</div></div>`).join("");
    $("#d-where").innerHTML = `<p class="muted">${esc(a?.notes || "")}</p><a class="btn ghost" href="https://br.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}" target="_blank" rel="noopener">Abrir no TradingView ↗</a>`;
  }
  advChart(tv, "240");
  $("#d-tabs").classList.toggle("hidden", isB3);
  $("#d-tabs").querySelector('[data-t="chart"]').classList.remove("hidden");
  $("#d-tabs").querySelector('[data-t="movs"]').classList.remove("hidden");
  $("#d-tabs").querySelector('[data-t="info"]').classList.toggle("hidden", isB3);
  $("#d-tabs").querySelector('[data-t="evo"]').classList.add("hidden");
  $("#d-evo").innerHTML = "";
  if (!isB3) renderAssetMovs(sym);
  showDetailTab("chart");
  $("#modal").classList.remove("hidden");
}

// ------------------------------------------------------------------ aba Informações
const cgDetail = new Map();
const big = (v, ccy) => {
  if (v == null || !isFinite(v)) return "—";
  if (S.hide) return "•••••";
  const sym = ccy === "BRL" ? "R$" : "US$";
  const a = Math.abs(v);
  const [d, u] = a >= 1e12 ? [1e12, " tri"] : a >= 1e9 ? [1e9, " bi"] : a >= 1e6 ? [1e6, " mi"] : a >= 1e3 ? [1e3, " mil"] : [1, ""];
  return `${sym} ${(v / d).toLocaleString("pt-BR", { maximumFractionDigits: d === 1 ? 2 : 2 })}${u}`;
};
const units = (v) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
const bothBig = (usd) => `${big(usd, "USD")}<div class="sub2">${big(usd != null && rate() ? usd * rate() : null, "BRL")}</div>`;
const bothPx = (usd) => `${price(usd, "USD")}<div class="sub2">${price(usd != null && rate() ? usd * rate() : null, "BRL")}</div>`;
const dt = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");
const statBox = ([k, v]) => `<div class="stat"><div class="muted small">${k}</div><div class="v">${v}</div></div>`;
const slugify = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const EXPLORER = {
  ethereum: "https://etherscan.io/token/", "binance-smart-chain": "https://bscscan.com/token/", "polygon-pos": "https://polygonscan.com/token/",
  "arbitrum-one": "https://arbiscan.io/token/", base: "https://basescan.org/token/", "optimistic-ethereum": "https://optimistic.etherscan.io/token/",
  avalanche: "https://snowtrace.io/token/", solana: "https://solscan.io/token/", tron: "https://tronscan.org/#/token20/",
  "polygon-zkevm": "https://zkevm.polygonscan.com/token/", linea: "https://lineascan.build/token/", zksync: "https://explorer.zksync.io/address/",
};
function linkBtn(href, label) {
  if (!href || !/^https?:\/\//i.test(href)) return "";
  return `<a class="lnk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
}
function plainText(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n"); // só lido como texto, nunca inserido
  return (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
async function renderInfo() {
  const el = $("#d-info");
  const d = S.detail;
  if (!d || el.dataset.for === `${d.kind}:${d.sym}` && el.innerHTML) return;
  el.dataset.for = `${d.kind}:${d.sym}`;
  el.innerHTML = '<p class="muted">Carregando informações…</p>';
  try {
    if (d.kind === "b3") return await renderInfoB3(el, d.sym);
    const m = CGM.map[d.sym];
    if (!m?.id) {
      el.innerHTML = `<p class="muted">Não encontrei <b>${esc(d.sym)}</b> no CoinGecko (token pequeno ou falso).</p>
        <div class="links">${linkBtn(`https://www.coingecko.com/pt/search?query=${encodeURIComponent(d.sym)}`, "Procurar no CoinGecko")}${linkBtn(`https://coinmarketcap.com/search/?q=${encodeURIComponent(d.sym)}`, "Procurar no CoinMarketCap")}</div>`;
      return;
    }
    let c = cgDetail.get(m.id);
    if (!c || Date.now() - c.at > 10 * 60e3) {
      const r = await fetch(`${CG}/coins/${encodeURIComponent(m.id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
      if (r.status === 429) throw new Error("O CoinGecko limitou as consultas por um minuto. Tente de novo daqui a pouco.");
      if (!r.ok) throw new Error(`CoinGecko respondeu ${r.status}`);
      c = { at: Date.now(), j: await r.json() };
      cgDetail.set(m.id, c);
    }
    if (S.detail !== d) return;
    const j = c.j, md = j.market_data || {};
    const U = (o) => (o && typeof o === "object" ? o.usd : o);
    const circ = md.circulating_supply, max = md.max_supply, tot = md.total_supply;
    const circPct = circ && (max || tot) ? circ / (max || tot) : null;
    const L = j.links || {};
    const desc = plainText(j.description?.pt || j.description?.en || "");
    const contracts = Object.entries(j.detail_platforms || {}).filter(([, v]) => v?.contract_address);
    const slug = j.web_slug || j.id;
    const changes = [["24h", md.price_change_percentage_24h], ["7d", md.price_change_percentage_7d], ["30d", md.price_change_percentage_30d], ["1 ano", md.price_change_percentage_1y]];
    el.innerHTML = `
      <div class="info-head">
        ${j.market_cap_rank ? `<span class="rank">#${j.market_cap_rank}</span>` : ""}
        <b>${esc(j.name)}</b> <span class="muted">${esc(String(j.symbol || "").toUpperCase())}</span>
        ${(j.categories || []).filter(Boolean).slice(0, 5).map((x) => `<span class="badge">${esc(x)}</span>`).join("")}
      </div>
      <div class="d-stats">${[
        ["Valor de mercado", bothBig(U(md.market_cap))],
        ["Valor totalmente diluído", bothBig(U(md.fully_diluted_valuation))],
        ["Volume 24h", bothBig(U(md.total_volume))],
        ["Máx. / mín. 24h", `${price(U(md.high_24h), "USD")}<div class="sub2">${price(U(md.low_24h), "USD")}</div>`],
      ].map(statBox).join("")}</div>
      <div class="info-grid">
        <div class="info-box">
          <h3>Fornecimento</h3>
          <div class="kv"><span>Em circulação</span><b>${units(circ)} ${esc(String(j.symbol || "").toUpperCase())}</b></div>
          <div class="kv"><span>Fornecimento total</span><b>${units(tot)}</b></div>
          <div class="kv"><span>Fornecimento máximo</span><b>${md.max_supply_infinite ? "∞ sem limite" : units(max)}</b></div>
          ${circPct ? `<div class="bar"><i style="width:${Math.min(100, circPct * 100).toFixed(1)}%;background:var(--accent)"></i></div><div class="muted small">${(circPct * 100).toFixed(1)}% do ${max ? "máximo" : "total"} já está em circulação</div>` : ""}
        </div>
        <div class="info-box">
          <h3>Recordes de preço</h3>
          <div class="kv"><span>Máxima histórica</span><b>${bothPx(U(md.ath))}</b></div>
          <div class="kv"><span>em</span><b>${dt(U(md.ath_date))} <span class="pct ${cls(U(md.ath_change_percentage))}">${U(md.ath_change_percentage) != null ? pct(U(md.ath_change_percentage) / 100) + " desde lá" : ""}</span></b></div>
          <div class="kv"><span>Mínima histórica</span><b>${bothPx(U(md.atl))}</b></div>
          <div class="kv"><span>em</span><b>${dt(U(md.atl_date))} <span class="pct ${cls(U(md.atl_change_percentage))}">${U(md.atl_change_percentage) != null ? pct(U(md.atl_change_percentage) / 100) + " desde lá" : ""}</span></b></div>
        </div>
        <div class="info-box">
          <h3>Variação do preço</h3>
          ${changes.map(([k, v]) => `<div class="kv"><span>${k}</span><b class="pct ${cls(v)}">${v != null ? pct(v / 100) : "—"}</b></div>`).join("")}
          ${j.genesis_date ? `<div class="kv"><span>Lançamento</span><b>${dt(j.genesis_date)}</b></div>` : ""}
          ${j.hashing_algorithm ? `<div class="kv"><span>Algoritmo</span><b>${esc(j.hashing_algorithm)}</b></div>` : ""}
        </div>
      </div>
      <h3>Links</h3>
      <div class="links">
        ${(L.homepage || []).filter(Boolean).slice(0, 1).map((u) => linkBtn(u, "Site do projeto")).join("")}
        ${linkBtn(L.whitepaper, "Whitepaper")}
        ${(L.blockchain_site || []).filter(Boolean).slice(0, 4).map((u) => linkBtn(u, "Explorador: " + u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])).join("")}
        ${(L.repos_url?.github || []).slice(0, 1).map((u) => linkBtn(u, "GitHub")).join("")}
        ${L.twitter_screen_name ? linkBtn(`https://x.com/${L.twitter_screen_name}`, "X (Twitter)") : ""}
        ${linkBtn(L.subreddit_url, "Reddit")}
        ${L.telegram_channel_identifier ? linkBtn(`https://t.me/${L.telegram_channel_identifier}`, "Telegram") : ""}
        ${linkBtn(`https://www.coingecko.com/pt/moedas/${slug}`, "CoinGecko")}
        ${linkBtn(`https://coinmarketcap.com/currencies/${slugify(j.name)}/`, "CoinMarketCap")}
      </div>
      ${contracts.length ? `<h3>Endereços do contrato</h3><div class="contracts">${contracts.slice(0, 8).map(([net, v]) => `
        <div class="kv"><span>${esc(net.replace(/-/g, " "))}</span><b><span class="cp mono">${esc(v.contract_address)}</span>
        <button type="button" class="btn small ghost" data-copy="${esc(v.contract_address)}" title="Copiar">Copiar</button>
        ${EXPLORER[net] ? linkBtn(EXPLORER[net] + v.contract_address, "ver") : ""}</b></div>`).join("")}</div>` : ""}
      ${desc ? `<h3>Sobre</h3><details class="about"><summary>${esc(desc.slice(0, 320))}${desc.length > 320 ? "… <span class='lnk'>ler mais</span>" : ""}</summary><p>${esc(desc.slice(320))}</p></details>` : ""}
      <p class="muted small">Dados do CoinGecko · atualizados ${ago(md.last_updated || j.last_updated)}.</p>`;
  } catch (e) {
    el.dataset.for = "";
    el.innerHTML = `<p class="err">${esc(e.message || e)}</p>`;
  }
}
async function renderInfoB3(el, sym) {
  const { data, error } = await sb.functions.invoke("quotes", { body: { info: sym }, region: REGION });
  if (error || !data?.info) throw new Error("Não consegui buscar os dados desta ação agora.");
  const i = data.info;
  const fromAth = i.ath && i.price ? i.price / i.ath - 1 : null;
  el.innerHTML = `
    <div class="info-head"><b>${esc(i.name || sym)}</b> <span class="muted">${esc(sym)} · ${esc(i.exchange || "B3")}</span></div>
    <div class="d-stats">${[
      ["Preço", `${price(i.price, "BRL")}<div class="sub2">${price(i.price && rate() ? i.price / rate() : null, "USD")}</div>`],
      ["Máx. / mín. do dia", `${price(i.dayHigh, "BRL")}<div class="sub2">${price(i.dayLow, "BRL")}</div>`],
      ["Máx. / mín. 52 semanas", `${price(i.w52High, "BRL")}<div class="sub2">${price(i.w52Low, "BRL")}</div>`],
      ["Volume do dia", units(i.volume)],
    ].map(statBox).join("")}</div>
    <div class="info-grid">
      <div class="info-box">
        <h3>Recordes de preço (fechamento mensal)</h3>
        <div class="kv"><span>Máxima histórica</span><b>${price(i.ath, "BRL")}</b></div>
        <div class="kv"><span>em</span><b>${i.athDate ? new Date(i.athDate * 1000).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—"} <span class="pct ${cls(fromAth)}">${fromAth != null ? pct(fromAth) + " desde lá" : ""}</span></b></div>
        <div class="kv"><span>Mínima histórica</span><b>${price(i.atl, "BRL")}</b></div>
        <div class="kv"><span>em</span><b>${i.atlDate ? new Date(i.atlDate * 1000).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—"}</b></div>
      </div>
      <div class="info-box">
        <h3>Variação</h3>
        ${[["1 mês", i.r1m], ["12 meses", i.r1y], ["5 anos", i.r5y]].map(([k, v]) => `<div class="kv"><span>${k}</span><b class="pct ${cls(v)}">${v != null ? pct(v) : "—"}</b></div>`).join("")}
        ${i.first ? `<div class="kv"><span>Histórico desde</span><b>${new Date(i.first * 1000).getFullYear()}</b></div>` : ""}
      </div>
    </div>
    <h3>Links</h3>
    <div class="links">
      ${linkBtn(`https://statusinvest.com.br/acoes/${sym.toLowerCase()}`, "Status Invest (indicadores e dividendos)")}
      ${linkBtn(`https://investidor10.com.br/acoes/${sym.toLowerCase()}/`, "Investidor10")}
      ${linkBtn(`https://br.tradingview.com/symbols/BMFBOVESPA-${sym}/`, "TradingView")}
      ${linkBtn(`https://finance.yahoo.com/quote/${sym}.SA`, "Yahoo Finance")}
      ${/^PETR/.test(sym) ? linkBtn("https://www.investidorpetrobras.com.br/", "Relações com investidores") : ""}
    </div>
    <p class="muted small">Cotação com atraso de ~15 min (Yahoo Finance).</p>`;
}

// movimentações
function renderMovs() {
  const sel = $("#mov-wallet");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Todas as carteiras</option>` + S.wallets.map((w) => `<option value="${w.id}">${esc(w.label)}</option>`).join("");
  sel.value = cur;
  const dir = $("#mov-dir").value;
  const q = $("#mov-q").value.trim().toUpperCase();
  const prices = Object.fromEntries(cryptoRows().map((r) => [r.sym, r.price]));
  const list = S.txs.filter((t) => (!cur || t.wallet_id === cur) && (!dir || t.direction === dir) && (!q || (t.symbol || "").toUpperCase().includes(q)));
  const dname = { in: "Entrada", out: "Saída", self: "Interna", trade: "Troca", buy: "Compra", sell: "Venda" };
  $("#movs-table").innerHTML =
    `<tr><th>Data</th><th>Tipo</th><th>Ativo</th><th>Quantidade</th><th class="hide-sm">Valor hoje</th><th class="hide-sm">Carteira</th><th class="hide-sm">Contraparte</th><th></th></tr>` +
    (list
      .map((t) => {
        const p = livePrice((t.symbol || "").toUpperCase(), prices[(t.symbol || "").toUpperCase()]);
        const v = p != null && t.amount != null ? p * Number(t.amount) : null;
        const peer = swapPeer(t);
        let cp = t.counterparty ? (t.counterparty.length > 26 && !t.quote_asset ? t.counterparty.slice(0, 10) + "…" + t.counterparty.slice(-8) : t.counterparty) : "";
        if (peer) cp = `troca ${t.direction === "in" ? "por" : "em"} ${qty(Number(peer.amount))} ${peer.symbol}`;
        if (t.quote_asset) cp += ` · ${qty(Number(t.quote_amount))} ${t.quote_asset}`;
        return `<tr>
          <td>${t.ts ? new Date(t.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
          <td><span class="${t.direction === "in" || t.direction === "buy" ? "up" : t.direction === "out" || t.direction === "sell" ? "down" : ""}">${peer ? (t.direction === "in" ? "Troca (entrou)" : "Troca (saiu)") : dname[t.direction] || t.direction}</span></td>
          <td><div class="asset sm">${icon((t.symbol || "?").toUpperCase(), "crypto", isSpamSym(t.symbol))}<div><b>${esc(t.symbol || "")}</b><div class="nets-small">${esc(NET[t.network] || t.network)}</div></div></div></td>
          <td>${qty(Number(t.amount))}</td>
          <td class="hide-sm">${dualUsd(v)}</td>
          <td class="hide-sm">${esc(t.source)}</td>
          <td class="hide-sm"><span class="nets-small cp" title="${esc(t.counterparty || "")}">${esc(cp)}</span></td>
          <td>${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">ver ↗</a>` : ""}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="8" class="empty">Sem movimentações ainda.</td></tr>`);
}

// cadastros
const HINTS = {
  evm: "Endereço 0x… da MetaMask (ou da conta Ethereum do Trezor). O mesmo endereço vale para todas as redes marcadas abaixo.",
  btc: "Cole a chave pública da conta (zpub…, ypub…, xpub… ou o descritor tr(…) da conta Taproot do Trezor Suite). Um endereço bc1… avulso também funciona. A chave pública só permite ver saldos.",
  cardano: "Endereço addr1… ou o endereço de stake stake1… (pega todos os endereços da carteira).",
  polkadot: "Endereço Polkadot (começa com 1…). Soma a rede principal e o Asset Hub.",
  binance: "Não precisa de endereço: usa a chave só de leitura guardada no Supabase.",
};
function renderWalletForm() {
  const k = $("#w-kind").value;
  $("#w-hint").textContent = HINTS[k];
  $("#w-addr-wrap").classList.toggle("hidden", k === "binance");
  $("#w-address").placeholder = { evm: "0x…", btc: "zpub… ou bc1…", cardano: "addr1… ou stake1…", polkadot: "1…" }[k] || "";
  $("#w-nets").innerHTML = k === "evm"
    ? EVM_NETS.map((n) => `<label><input type="checkbox" value="${n}" ${EVM_DEFAULT.includes(n) ? "checked" : ""}/> ${NET[n]}</label>`).join("")
    : "";
}
function renderCadastros() {
  $("#wallet-list").innerHTML = S.wallets
    .map((w) => {
      const n = S.holdings.filter((h) => h.wallet_id === w.id);
      const v = n.reduce((s, h) => s + Number(h.value_usd || 0), 0);
      const last = n.reduce((m, x) => (x.updated_at > m ? x.updated_at : m), "");
      return `<div class="item ${w.active ? "" : "off"}">
        <span class="badge">${KIND[w.kind]}</span>
        <div class="grow"><b>${esc(w.label)}</b> <span class="muted small">${money(toCcy(v))}${last ? " · " + ago(last) : ""}</span>
          <div class="addr">${esc(w.address || "chave guardada no Supabase")}${w.kind === "evm" ? " · " + (w.networks || []).map((x) => NET[x] || x).join(", ") : ""}</div></div>
        <button class="btn small" data-act="sync" data-id="${w.id}">Atualizar</button>
        ${w.kind === "binance" ? `<button class="btn small" data-act="hist" data-id="${w.id}">Importar histórico</button><button class="btn small" data-act="csv" data-id="${w.id}" title="Para operações antigas que a API da Binance não devolve">Importar extrato (CSV)</button>` : ""}
        <button class="btn small ghost" data-act="toggle" data-id="${w.id}">${w.active ? "Desativar" : "Ativar"}</button>
        <button class="btn small ghost danger" data-act="del" data-id="${w.id}">Excluir</button>
      </div>`;
    })
    .join("") || '<p class="muted">Nenhuma carteira cadastrada.</p>';

  const kindName = { b3: "B3", renda_fixa: "Renda fixa", outro: "Outro" };
  $("#manual-list").innerHTML = S.manual
    .map((a) => `<div class="item">
        <span class="badge">${kindName[a.kind]}</span>
        <div class="grow"><b>${esc(a.symbol)}</b> <span class="muted small">${esc(a.name || "")}</span>
          <div class="addr">${a.kind === "b3" ? `${qty(Number(a.quantity))} × ${price(Number(a.avg_price || 0), a.currency)}` : money(a.current_value ?? null, a.currency)}${a.start_date ? " · desde " + fmtDate(a.start_date) : " · sem data"} · ${opsOf(a.id).length} operação(ões)${a.notes ? " · " + esc(a.notes) : ""}</div></div>
        <button class="btn small" data-mact="ops" data-id="${a.id}">Operações</button>
        <button class="btn small ghost" data-mact="edit" data-id="${a.id}">Editar</button>
        <button class="btn small ghost danger" data-mact="del" data-id="${a.id}">Excluir</button>
      </div>`)
    .join("") || '<p class="muted">Nenhum ativo cadastrado.</p>';
}

// ------------------------------------------------------------------ Bitcoin: primeira leitura pelo navegador
// (os servidores públicos de Bitcoin limitam muito as consultas vindas de servidores na nuvem;
// do seu navegador a varredura é rápida. Depois disso o servidor só confere os endereços já conhecidos.)
const BTC_VERS = { xpub: 0x0488b21e, ypub: 0x049d7cb2, zpub: 0x04b24746 };
function parseBtc(input) {
  const s = input.trim();
  const m = s.match(/([xyz]pub[1-9A-HJ-NP-Za-km-z]{100,})/);
  if (!m) return null;
  const key = m[1];
  if (/^tr\(/i.test(s)) return { key, type: "p2tr" };
  if (/^sh\(wpkh/i.test(s)) return { key, type: "p2sh-p2wpkh" };
  if (/^wpkh\(/i.test(s)) return { key, type: "p2wpkh" };
  if (/^pkh\(/i.test(s)) return { key, type: "p2pkh" };
  const p = key.slice(0, 4);
  return { key, type: p === "zpub" ? "p2wpkh" : p === "ypub" ? "p2sh-p2wpkh" : "p2pkh" };
}
async function btcDiscover(w, onProgress) {
  const parsed = parseBtc(w.address || "");
  if (!parsed) return;
  const [{ HDKey }, btc] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/@scure/bip32@1.6.2/+esm"),
    import("https://cdn.jsdelivr.net/npm/@scure/btc-signer@1.6.0/+esm"),
  ]);
  const hd = HDKey.fromExtendedKey(parsed.key, { private: 0, public: BTC_VERS[parsed.key.slice(0, 4)] });
  const addr = (pub) =>
    parsed.type === "p2wpkh" ? btc.p2wpkh(pub).address
    : parsed.type === "p2sh-p2wpkh" ? btc.p2sh(btc.p2wpkh(pub)).address
    : parsed.type === "p2tr" ? btc.p2tr(pub.slice(1)).address
    : btc.p2pkh(pub).address;
  const get = async (a, tries = 4) => {
    for (let i = 0; i < tries; i++) {
      const r = await fetch(`https://mempool.space/api/address/${a}`).catch(() => null);
      if (r?.ok) return r.json();
      await new Promise((ok) => setTimeout(ok, 700 * (i + 1)));
    }
    throw new Error("mempool.space não respondeu");
  };
  const used = [];
  for (const chain of [0, 1]) {
    const node = hd.deriveChild(chain);
    let idx = 0, gap = 0;
    while (gap < 20 && idx < 2000) {
      const batch = Array.from({ length: 10 }, (_, k) => ({ idx: idx + k, address: addr(node.deriveChild(idx + k).publicKey) }));
      idx += 10;
      const res = [];
      for (let i = 0; i < batch.length; i += 5) res.push(...(await Promise.all(batch.slice(i, i + 5).map(async (b) => ({ ...b, d: await get(b.address) })))));
      for (const b of res) {
        const n = b.d.chain_stats.tx_count + b.d.mempool_stats.tx_count;
        if (n > 0) { used.push({ chain, idx: b.idx, address: b.address }); gap = 0; } else gap++;
      }
      onProgress?.(`${w.label}: ${used.length} endereço(s) com uso encontrados (verificados ${chain ? "troco" : "recebimento"} até o nº ${idx})`);
    }
  }
  const meta = { type: parsed.type, used, at: new Date().toISOString(), via: "navegador" };
  const { error } = await sb.from("wallets").update({ meta }).eq("id", w.id);
  if (error) throw error;
  w.meta = meta;
}

// ------------------------------------------------------------------ sincronização
async function runSync(walletId) {
  const btn = $("#sync");
  btn.disabled = true;
  btn.textContent = "Atualizando…";
  const rep = $("#sync-report");
  rep.classList.remove("hidden");
  rep.innerHTML = '<span class="muted">Consultando blockchains e corretoras… pode levar até um minuto.</span>';
  try {
    const btcs = S.wallets.filter((w) => w.active && w.kind === "btc" && parseBtc(w.address || "") && (walletId ? w.id === walletId : !w.meta?.used));
    for (const w of btcs) {
      await btcDiscover(w, (t) => (rep.innerHTML = `<span class="muted">Lendo o Bitcoin pelo navegador… ${esc(t)}</span>`)).catch((e) => console.warn(e));
    }
    rep.innerHTML = '<span class="muted">Consultando blockchains e corretoras… pode levar até um minuto.</span>';
    const { data, error } = await sb.functions.invoke("sync", { body: walletId ? { wallet_id: walletId } : {}, region: REGION });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).erro || msg; } catch { /* */ }
      throw new Error(msg);
    }
    rep.innerHTML = (data.carteiras || [])
      .map((c) => c.ok ? `<div>✓ <b>${esc(c.carteira)}</b> <span class="muted">${c.ativos} ativo(s), ${c.movimentacoes} movimentação(ões)</span></div>`
        : c.erro ? `<div class="err">✗ <b>${esc(c.carteira)}</b>: ${esc(c.erro)}</div>` : `<div class="muted">${esc(c.carteira)}: ${esc(c.aviso)}</div>`)
      .join("") || '<span class="muted">Nenhuma carteira ativa.</span>';
    await loadAll();
  } catch (e) {
    rep.innerHTML = `<div class="err">Erro: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Atualizar saldos";
  }
}

// ------------------------------------------------------------------ extrato CSV da Binance
// Binance → Carteira → Histórico de transações → Gerar todos os extratos (máx. 12 meses por arquivo)
// Colunas: User_ID, UTC_Time, Account, Operation, Coin, Change, Remark
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
function csvDate(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/))) return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if ((m = s.match(/^(\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/))) return Date.UTC(2000 + +m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?/))) return Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(s + "Z");
  return isNaN(t) ? null : t;
}
const FIATS = new Set(["BRL", "USD", "EUR"]);
const isCash = (c) => STABLE.has(c) || FIATS.has(c);
async function importBinanceCSV(files) {
  const rep = $("#sync-report");
  rep.classList.remove("hidden");
  rep.innerHTML = '<span class="muted">Lendo o extrato…</span>';
  rep.scrollIntoView({ behavior: "smooth", block: "center" });
  const all = [];
  for (const f of files) {
    const rows = parseCSV(await f.text());
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    const ix = (n) => head.indexOf(n);
    const iT = ix("utc_time"), iA = ix("account"), iO = ix("operation"), iC = ix("coin"), iV = ix("change");
    if (iT < 0 || iO < 0 || iC < 0 || iV < 0) {
      rep.innerHTML = `<div class="err">O arquivo ${esc(f.name)} não parece ser o "Histórico de transações" da Binance (faltam as colunas UTC_Time, Operation, Coin e Change).</div>`;
      return;
    }
    for (const r of rows) {
      const ts = csvDate(r[iT] || "");
      const v = Number(String(r[iV] || "").replace(/[^\d.eE+-]/g, ""));
      if (!ts || !isFinite(v) || !v) continue;
      all.push({ ts, acc: (r[iA] || "").trim(), op: (r[iO] || "").trim(), coin: (r[iC] || "").trim().toUpperCase(), v });
    }
  }
  const SKIP = /transfer|subscription|redemption|savings purchase|savings principal|staking purchase|staking redemption|main account|funding account|isolated|margin loan|repay|collateral/i;
  const INCOME = /interest|distribution|reward|airdrop|staking rewards|launchpool|mining|cashback|commission|bonus|dividend/i;
  const MOVE_IN = /^deposit$|crypto deposit|fiat deposit|p2p.*(buy|receive)/i;
  const MOVE_OUT = /^withdraw|crypto withdraw|fiat withdraw/i;
  const FEE = /fee/i;
  // agrupa por segundo + conta (uma operação gera várias linhas)
  const groups = new Map(), moves = [], income = new Map();
  for (const r of all) {
    if (MOVE_IN.test(r.op) || MOVE_OUT.test(r.op)) { moves.push(r); continue; }
    if (SKIP.test(r.op)) continue;
    if (INCOME.test(r.op) && r.v > 0) {
      const k = `${r.coin}|${new Date(r.ts).toISOString().slice(0, 7)}`;
      income.set(k, (income.get(k) || 0) + r.v);
      continue;
    }
    const k = `${Math.floor(r.ts / 1000)}|${r.acc}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  // trades que já vieram pela API (para não contar duas vezes)
  const { data: api } = await sb.from("binance_trades").select("id,ts,base,quote").neq("kind", "csv");
  const apiKeys = (api || []).map((t) => ({ t: new Date(t.ts).getTime(), pair: [t.base, t.quote].sort().join("/") }));
  const dupe = (ts, a, b) => { const pair = [a, b].sort().join("/"); return apiKeys.some((x) => x.pair === pair && Math.abs(x.t - ts) < 90_000); };
  const trades = [];
  let skipped = 0, odd = 0;
  for (const [, rs] of groups) {
    const net = new Map(), fee = new Map();
    for (const r of rs) {
      const m = FEE.test(r.op) ? fee : net;
      m.set(r.coin, (m.get(r.coin) || 0) + r.v);
    }
    const pos = [...net].filter(([, v]) => v > 0), neg = [...net].filter(([, v]) => v < 0);
    if (pos.length !== 1 || neg.length !== 1) { if (pos.length || neg.length) odd++; continue; }
    const [rc, rv] = pos[0], [sc, sv] = neg[0];
    const ts = rs[0].ts;
    if (dupe(ts, rc, sc)) { skipped++; continue; }
    const sell = isCash(rc) && !isCash(sc);
    const t = sell
      ? { base: sc, quote: rc, base_qty: -sv, quote_qty: rv, is_buy: false }
      : { base: rc, quote: sc, base_qty: rv, quote_qty: -sv, is_buy: true };
    const [fc, fv] = [...fee][0] || [null, 0];
    trades.push({ user_id: S.user.id, kind: "csv", ts: new Date(ts).toISOString(), ...t, fee: fc ? Math.abs(fv) : null, fee_asset: fc,
      id: `csv:${ts}:${t.base}:${t.quote}:${t.base_qty}` });
  }
  // depósitos, saques e rendimentos viram movimentações
  const txs = [];
  for (const r of moves) {
    const dir = MOVE_IN.test(r.op) ? "in" : "out";
    txs.push({ user_id: S.user.id, source: "Binance", wallet_id: S.wallets.find((w) => w.kind === "binance")?.id ?? null, network: "binance",
      tx_hash: `csv-${dir}-${r.ts}-${r.coin}-${Math.abs(r.v)}`, ts: new Date(r.ts).toISOString(), direction: dir, symbol: r.coin, amount: Math.abs(r.v),
      counterparty: `extrato Binance: ${r.op}` });
  }
  for (const [k, v] of income) {
    const [coin, ym] = k.split("|");
    txs.push({ user_id: S.user.id, source: "Binance", wallet_id: S.wallets.find((w) => w.kind === "binance")?.id ?? null, network: "binance",
      tx_hash: `csv-rend-${coin}-${ym}`, ts: new Date(ym + "-28T12:00:00Z").toISOString(), direction: "in", symbol: coin, amount: v,
      counterparty: `rendimentos de ${ym.split("-").reverse().join("/")} (Earn, staking, airdrops)` });
  }
  rep.innerHTML = `<span class="muted">Gravando ${trades.length} operações e ${txs.length} movimentações…</span>`;
  for (let i = 0; i < trades.length; i += 500) {
    const { error } = await sb.from("binance_trades").upsert(trades.slice(i, i + 500), { onConflict: "user_id,id", ignoreDuplicates: true });
    if (error) { rep.innerHTML = `<div class="err">Erro ao gravar: ${esc(error.message)}</div>`; return; }
  }
  for (let i = 0; i < txs.length; i += 500) {
    const { error } = await sb.from("transactions").upsert(txs.slice(i, i + 500), { onConflict: "user_id,network,tx_hash,symbol,direction", ignoreDuplicates: true });
    if (error) { rep.innerHTML = `<div class="err">Erro ao gravar: ${esc(error.message)}</div>`; return; }
  }
  const first = all.length ? new Date(Math.min(...all.map((r) => r.ts))).toLocaleDateString("pt-BR") : "—";
  const last = all.length ? new Date(Math.max(...all.map((r) => r.ts))).toLocaleDateString("pt-BR") : "—";
  rep.innerHTML = `<div>✓ <b>Extrato lido</b> (${first} a ${last}): ${trades.length} compra(s)/venda(s), ${moves.length} depósito(s)/saque(s) e ${income.size} mês(es) de rendimentos.${skipped ? ` ${skipped} operação(ões) já tinham vindo pela API e foram ignoradas.` : ""}${odd ? ` ${odd} lançamento(s) com mais de duas moedas ficaram de fora (ex.: conversão de "poeira" em BNB).` : ""}</div><div class="muted">Recalculando o preço médio…</div>`;
  await runHist(null, true);
}

// histórico da Binance (compras, vendas, convert, compras com reais) → preço médio
async function runHist(btn, keep) {
  const rep = $("#sync-report");
  btn && (btn.disabled = true);
  rep.classList.remove("hidden");
  const before = keep ? rep.innerHTML.replace(/<div class="muted">Recalculando[^<]*<\/div>/, "") : "";
  rep.innerHTML = before + '<span class="muted">Importando o histórico da Binance… a primeira vez pode levar uns 2 minutos.</span>';
  rep.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const { data, error } = await sb.functions.invoke("historico", { body: {}, region: REGION });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).erro || msg; } catch { /* */ }
      throw new Error(msg);
    }
    rep.innerHTML = before + `<div>✓ <b>Histórico da Binance</b>: ${data.operacoes} operação(ões) no total (novas agora: ${data.spot.novas} spot, ${data.convert.novas} convert, ${data.compras_com_reais.novas} compras/vendas com reais). Preço médio calculado para ${data.ativos_com_preco_medio} ativo(s).</div>` +
      (data.completo ? `<div class="muted">Histórico lido desde ${new Date(data.historico_ate + "T12:00").toLocaleDateString("pt-BR")}.</div>` : `<div class="err">Ainda falta uma parte (lido até ${new Date(data.historico_ate + "T12:00").toLocaleDateString("pt-BR")}). Clique em "Importar histórico" de novo para continuar de onde parou.</div>`);
    await loadAll();
  } catch (e) {
    rep.innerHTML = `<div class="err">Erro no histórico: ${esc(e.message)}</div>`;
  } finally {
    btn && (btn.disabled = false);
  }
}

// ------------------------------------------------------------------ operações de B3 / renda fixa
const fmtDate = (d) => (d ? new Date(d + "T12:00").toLocaleDateString("pt-BR") : "");
const daysSince = (d) => Math.max(0, Math.round((Date.now() - new Date(d + "T12:00").getTime()) / 86400e3));
function opsOf(assetId) {
  return S.ops.filter((o) => o.asset_id === assetId).sort((a, b) => a.op_date.localeCompare(b.op_date) || a.created_at.localeCompare(b.created_at));
}
// custo médio: compras somam (com taxas); vendas tiram pelo preço médio
function calcPosition(ops, until = null) {
  let q = 0, cost = 0;
  for (const o of ops) {
    if (until && o.op_date > until) break;
    const n = Number(o.quantity), p = Number(o.price), f = Number(o.fees || 0);
    if (o.kind === "buy") { cost += n * p + f; q += n; }
    else if (q > 0) { const sold = Math.min(n, q); cost -= (cost / q) * sold; q -= sold; }
  }
  return { q, cost, avg: q > 0 ? cost / q : null };
}
async function recalcAsset(assetId) {
  const ops = opsOf(assetId);
  if (!ops.length) return;
  const p = calcPosition(ops);
  await sb.from("manual_assets").update({ quantity: p.q, avg_price: p.avg, start_date: ops[0].op_date }).eq("id", assetId);
}
async function afterOpsChange(assetId) {
  const { data } = await sb.from("manual_ops").select("*").order("op_date");
  S.ops = data || [];
  await recalcAsset(assetId);
  await loadAll();
  openManual(assetId, "movs");
}
function alertOp(t) {
  const el = $("#op-msg");
  if (el) { el.textContent = t; el.className = "msg err"; } else alertMsg(t);
}

let evoChart = null;
function openManual(id, tab) {
  const a = manualRows().find((x) => x.id === id);
  if (!a) return;
  const isB3 = a.kind === "b3";
  const tv = a.tv_symbol || `BMFBOVESPA:${a.symbol.toUpperCase()}`;
  const ops = opsOf(id);
  S.detail = { kind: isB3 ? "b3" : "rf", sym: a.symbol, id };
  $("#d-title").innerHTML = `${icon(a.symbol, isB3 ? "b3" : "rf")}<span>${esc(a.symbol)}</span>${a.name ? `<span class="muted d-name">${esc(a.name)}</span>` : ""}`;
  $("#d-info").innerHTML = "";
  $("#d-tabs").querySelector('[data-t="info"]').classList.toggle("hidden", !isB3);
  $("#d-flag").innerHTML = "";
  $("#d-form").classList.add("hidden");
  $("#d-tabs").classList.remove("hidden");
  $("#d-tabs").querySelector('[data-t="chart"]').classList.toggle("hidden", !isB3);
  $("#d-tabs").querySelector('[data-t="evo"]').classList.remove("hidden");
  $("#d-tabs").querySelector('[data-t="movs"]').textContent = `Movimentações (${ops.length})`;
  const first = ops[0]?.op_date || a.start_date;
  $("#d-stats").innerHTML = [
    ...(isB3 ? [["Preço agora", `${price(a.px, "BRL")}<div class="sub2">${price(a.px && rate() ? a.px / rate() : null, "USD")}</div>`], ["Dia", `<span class="${cls(a.ch)}">${pct(a.ch) || "—"}</span>`], ["Quantidade", qty(Number(a.quantity))]] : []),
    [isB3 ? "Preço médio" : "Valor aplicado", isB3 ? `${price(Number(a.avg_price) || null, "BRL")}` : money(a.costBrl, "BRL")],
    ["Valor hoje", `${money(a.valueBrl, "BRL")}<div class="sub2">${money(a.valueBrl && rate() ? a.valueBrl / rate() : null, "USD")}</div>`],
    ["Resultado", a.pnlBrl != null ? `<span class="${cls(a.pnlBrl)}">${money(a.pnlBrl, "BRL")}</span><div class="sub2 ${cls(a.pnlBrl)}">${a.costBrl ? pct(a.pnlBrl / a.costBrl) : ""}</div>` : "—"],
    ["Desde", first ? `${fmtDate(first)}<div class="sub2">há ${daysSince(first)} dias</div>` : '<span class="muted small">sem data</span>'],
  ].map(([k, v]) => `<div class="stat"><div class="muted small">${k}</div><div class="v">${v}</div></div>`).join("");
  $("#d-where").innerHTML = `<p class="muted">${esc(a.notes || "")}</p>${isB3 ? `<a class="btn ghost" href="https://br.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}" target="_blank" rel="noopener">Abrir no TradingView ↗</a>` : ""}`;
  renderManualOps(a, ops);
  if (isB3) {
    advChart(tv, "D");
  } else $("#d-chart").innerHTML = "";
  $("#d-evo").dataset.asset = id;
  $("#d-evo").dataset.loaded = "";
  showDetailTab(tab || (ops.length ? (isB3 ? "evo" : "movs") : "movs"));
  $("#modal").classList.remove("hidden");
}
function renderManualOps(a, ops) {
  const isB3 = a.kind === "b3";
  const px = isB3 ? a.px : null;
  const today = new Date().toISOString().slice(0, 10);
  const noDate = !ops.length && Number(a.quantity) > 0;
  $("#d-movs").innerHTML = `
    ${noDate ? `<div class="flagbox warn"><b>Esta posição ainda não tem data.</b> Informe abaixo a data da compra (já preenchi quantidade e preço com o que estava cadastrado) para o app mostrar a evolução desde então.</div>` : ""}
    <div class="table-wrap"><table class="assets">
      <tr><th>Data</th><th>Operação</th>${isB3 ? "<th>Quantidade</th><th>Preço</th>" : ""}<th>Total</th>${isB3 ? '<th class="hide-sm">Resultado hoje</th>' : ""}<th></th></tr>
      ${ops.slice().reverse().map((o) => {
        const n = Number(o.quantity), p = Number(o.price), tot = n * p + (o.kind === "buy" ? 1 : -1) * Number(o.fees || 0);
        const res = isB3 && o.kind === "buy" && px ? (px - p) * n : null;
        return `<tr>
          <td>${fmtDate(o.op_date)}<div class="nets-small">há ${daysSince(o.op_date)} dias</div></td>
          <td><span class="${o.kind === "buy" ? "up" : "down"}">${o.kind === "buy" ? (isB3 ? "Compra" : "Aplicação") : (isB3 ? "Venda" : "Resgate")}</span></td>
          ${isB3 ? `<td>${qty(n)}</td><td>${price(p, "BRL")}</td>` : ""}
          <td>${money(tot, "BRL")}${o.fees ? `<div class="nets-small">taxas ${money(Number(o.fees), "BRL")}</div>` : ""}</td>
          ${isB3 ? `<td class="hide-sm">${res != null ? `<span class="${cls(res)}">${money(res, "BRL")}</span><div class="nets-small ${cls(res)}">${pct(res / (n * p))}</div>` : "—"}</td>` : ""}
          <td><button type="button" class="btn small ghost danger" data-delop="${o.id}" title="Excluir">✕</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="7" class="empty">Nenhuma operação registrada.</td></tr>`}
    </table></div>
    <form id="op-form" class="form" data-asset="${a.id}">
      <h3>${noDate ? "Registrar a compra com data" : "Adicionar operação"}</h3>
      <div class="row">
        <label>Operação<select name="kind"><option value="buy">${isB3 ? "Compra" : "Aplicação"}</option><option value="sell">${isB3 ? "Venda" : "Resgate"}</option></select></label>
        <label>Data<input type="date" name="date" max="${today}" required /></label>
        ${isB3 ? `<label>Quantidade<input type="number" name="qty" step="any" min="0" value="${noDate ? Number(a.quantity) : ""}" /></label>` : '<input type="hidden" name="qty" value="1" />'}
        <label>${isB3 ? "Preço por ação (R$)" : "Valor (R$)"}<input type="number" name="price" step="any" min="0" value="${noDate && a.avg_price ? Number(a.avg_price) : ""}" /></label>
        <label>Taxas (R$)<input type="number" name="fees" step="any" min="0" placeholder="0" /></label>
      </div>
      <label>Observação<input name="notes" placeholder="opcional" /></label>
      <div class="row-btns"><button class="btn primary" type="submit">Salvar operação</button></div>
      <p id="op-msg" class="msg"></p>
    </form>`;
}
// evolução da posição: valor da posição em cada dia × quanto foi investido
async function renderEvolution() {
  const el = $("#d-evo");
  const a = manualRows().find((x) => x.id === el.dataset.asset);
  if (!a || el.dataset.loaded) return;
  el.dataset.loaded = "1";
  const ops = opsOf(a.id);
  if (!ops.length) {
    el.innerHTML = '<p class="muted">Registre a data da compra na aba <b>Movimentações</b> para ver a evolução.</p>';
    return;
  }
  if (a.kind !== "b3") {
    el.innerHTML = `<p class="muted">Renda fixa não tem cotação diária pública. Aplicado: <b>${money(a.costBrl, "BRL")}</b> desde ${fmtDate(ops[0].op_date)}; valor atual informado: <b>${money(a.valueBrl, "BRL")}</b> (${a.costBrl ? pct(a.pnlBrl / a.costBrl) : "—"}).</p>`;
    return;
  }
  el.innerHTML = '<div class="evo-legend"><span><i style="background:#3987e5"></i>Valor da posição</span><span><i style="background:#d95926"></i>Valor investido</span></div><div id="evo-chart" class="evo-chart"></div><p class="muted small" id="evo-note">Carregando o histórico de preços…</p>';
  try {
    const { data, error } = await sb.functions.invoke("quotes", { body: { history: a.symbol, from: ops[0].op_date }, region: REGION });
    if (error) throw error;
    const pts = (data.pontos || []).filter((p) => new Date(p.t * 1000).toISOString().slice(0, 10) >= ops[0].op_date);
    if (!pts.length) throw new Error("sem dados de preço para o período");
    const value = [], invested = [];
    for (const p of pts) {
      const day = new Date(p.t * 1000).toISOString().slice(0, 10);
      const pos = calcPosition(ops, day);
      value.push({ time: p.t, value: +(pos.q * p.c).toFixed(2) });
      invested.push({ time: p.t, value: +pos.cost.toFixed(2) });
    }
    if (a.px) {
      const pos = calcPosition(ops);
      const now = Math.floor(Date.now() / 1000);
      if (now > value[value.length - 1].time + 3600) { value.push({ time: now, value: +(pos.q * a.px).toFixed(2) }); invested.push({ time: now, value: +pos.cost.toFixed(2) }); }
    }
    evoChart?.remove();
    evoChart = LightweightCharts.createChart($("#evo-chart"), {
      ...chartOpts(),
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
      localization: { locale: "pt-BR", priceFormatter: (v) => money(v, "BRL") }, autoSize: true,
    });
    const sv = evoChart.addAreaSeries({ lineColor: "#3987e5", topColor: "rgba(57,135,229,.3)", bottomColor: "rgba(57,135,229,0)", lineWidth: 2 });
    sv.setData(value);
    evoChart.addLineSeries({ color: "#d95926", lineWidth: 2, lineStyle: 2, lineType: 1 }).setData(invested);
    sv.setMarkers(ops.map((o) => {
      const t = Math.floor(new Date(o.op_date + "T12:00").getTime() / 1000);
      const near = value.reduce((b, v) => (Math.abs(v.time - t) < Math.abs(b.time - t) ? v : b), value[0]);
      return { time: near.time, position: o.kind === "buy" ? "belowBar" : "aboveBar", color: o.kind === "buy" ? "#16c784" : "#ea3943", shape: o.kind === "buy" ? "arrowUp" : "arrowDown", text: `${o.kind === "buy" ? "Compra" : "Venda"} ${S.hide ? "" : qty(Number(o.quantity))}` };
    }).sort((x, y) => x.time - y.time));
    evoChart.timeScale().fitContent();
    const last = value[value.length - 1].value, inv = invested[invested.length - 1].value;
    $("#evo-note").innerHTML = `Desde ${fmtDate(ops[0].op_date)}: investido ${money(inv, "BRL")}, vale ${money(last, "BRL")} hoje (<span class="${cls(last - inv)}">${pct(inv ? (last - inv) / inv : null)}</span>). Fechamentos diários da B3 (Yahoo Finance); dividendos não estão incluídos.`;
  } catch (e) {
    $("#evo-note").textContent = `Não consegui carregar o histórico: ${e.message}`;
  }
}

// ------------------------------------------------------------------ eventos
function bind() {
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== "tab-" + b.dataset.tab));
      if (b.dataset.tab === "painel") renderChart();
    }));
  document.querySelectorAll("#ccy button").forEach((b) => {
    b.classList.toggle("active", b.dataset.ccy === S.ccy);
    b.addEventListener("click", () => {
      S.ccy = b.dataset.ccy;
      store("ccy", S.ccy);
      document.querySelectorAll("#ccy button").forEach((x) => x.classList.toggle("active", x === b));
      renderAll();
    });
  });
  document.querySelectorAll("#range button").forEach((b) =>
    b.addEventListener("click", () => {
      S.range = Number(b.dataset.r);
      document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("active", x === b));
      renderChart();
    }));
  setTheme(theme());
  $("#theme").addEventListener("click", () => setTheme(theme() === "light" ? "dark" : "light"));
  $("#d-info").addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "Copiado ✓"; setTimeout(() => (b.textContent = "Copiar"), 1500); });
  });
  const applyEye = () => {
    document.body.classList.toggle("privacy", S.hide);
    $("#eye").innerHTML = S.hide ? EYE_OFF : EYE_ON;
    $("#eye").title = S.hide ? "Mostrar valores" : "Ocultar valores";
  };
  applyEye();
  $("#eye").addEventListener("click", () => {
    S.hide = !S.hide;
    store("hide", S.hide ? "1" : "0");
    applyEye();
    filtersBuilt = "";
    renderAll();
  });
  $("#fx").addEventListener("click", () => {
    S.fxSrc = S.fxSrc === "com" ? "usdt" : "com";
    store("fxSrc", S.fxSrc);
    renderFx();
    renderAll();
  });
  const setF = (k, v) => {
    S.filters[k] = v;
    saveFilters();
    renderPainel();
  };
  $("#show-spam").addEventListener("change", (e) => setF("spam", e.target.checked));
  $("#f-q").addEventListener("input", (e) => setF("q", e.target.value));
  $("#f-net").addEventListener("change", (e) => setF("net", e.target.value));
  $("#f-res").addEventListener("change", (e) => setF("res", e.target.value));
  $("#f-min").addEventListener("input", (e) => setF("min", e.target.value));
  $("#f-minq").addEventListener("input", (e) => setF("minq", e.target.value));
  $("#f-locals").addEventListener("click", (e) => {
    const b = e.target.closest("[data-local]");
    if (!b) return;
    const l = b.dataset.local;
    const ls = S.filters.locals;
    setF("locals", ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]);
  });
  $("#f-clear").addEventListener("click", () => {
    S.filters = { q: "", locals: [], net: "", res: "", min: "", minq: "", spam: S.filters.spam };
    saveFilters();
    renderPainel();
  });
  ["#crypto-table", "#manual-table"].forEach((id) =>
    $(id).addEventListener("click", (e) => {
      const h = e.target.closest("th[data-k]");
      if (!h) return;
      e.stopPropagation();
      const k = h.dataset.k;
      S.sort = { k, d: S.sort.k === k ? -S.sort.d : k === "sym" ? 1 : -1 };
      renderPainel();
    }, true));
  $("#tv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) $("#tv-list").value = await file.text();
  });
  $("#tv-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#tv-list").value.trim();
    const { error } = await sb.from("user_prefs").upsert({ user_id: S.user.id, tv_watchlist: text || null, updated_at: new Date().toISOString() });
    if (error) return alertMsg(error.message);
    S.prefs.tv_watchlist = text;
    renderWatchlist();
    renderTape();
  });
  $("#sync").addEventListener("click", () => runSync());
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  $("#crypto-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-sym]");
    if (tr) openAsset(tr.dataset.sym);
  });
  $("#manual-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-mid]");
    if (tr) openManual(tr.dataset.mid);
  });
  $("#d-movs").addEventListener("submit", async (e) => {
    if (e.target.id !== "op-form") return;
    e.preventDefault();
    const f = e.target;
    const a = S.manual.find((x) => x.id === f.dataset.asset);
    const isRF = a.kind !== "b3";
    const row = {
      asset_id: a.id, kind: f.kind.value, op_date: f.date.value,
      quantity: isRF ? 1 : Number(f.qty.value), price: Number(f.price.value), fees: Number(f.fees.value || 0), notes: f.notes.value.trim() || null,
    };
    if (!row.op_date || !(row.quantity > 0) || !(row.price > 0)) return alertOp("Preencha data, quantidade e preço.");
    const { error } = await sb.from("manual_ops").insert(row);
    if (error) return alertOp(error.message);
    await afterOpsChange(a.id);
  });
  $("#d-movs").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-delop]");
    if (!b) return;
    const o = S.ops.find((x) => x.id === b.dataset.delop);
    if (!(await confirmBox("Excluir esta operação?"))) return;
    await sb.from("manual_ops").delete().eq("id", o.id);
    await afterOpsChange(o.asset_id);
  });
  $("#d-close").addEventListener("click", closeModal);
  $("#spam-note").addEventListener("click", (e) => {
    if (e.target.id !== "show-flagged") return;
    e.preventDefault();
    setF("spam", true);
  });
  $("#d-flag").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-flag]");
    if (!b) return;
    const sym = $("#d-flag").dataset.sym;
    const parts = S.holdings.filter((h) => h.symbol === sym && h.contract);
    const rows = parts.map((p) => ({ user_id: S.user.id, network: p.network, contract: p.contract.toLowerCase(), status: b.dataset.flag }));
    const { error } = await sb.from("token_flags").upsert(rows);
    if (error) return alertMsg(error.message);
    for (const r of rows) S.flags[`${r.network}:${r.contract}`] = r.status;
    closeModal();
    renderAll();
    sb.functions.invoke("sync", { body: {}, region: REGION }).then(() => loadAll()).catch(() => {});
  });
  $("#d-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-t]");
    if (b) showDetailTab(b.dataset.t);
  });
  $("#pie-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]");
    if (!b) return;
    S.pieMode = b.dataset.m;
    store("pie", S.pieMode);
    renderPie();
  });
  $("#pie").addEventListener("mouseover", (e) => { const p = e.target.closest("path"); pieHover(p ? p.dataset.i : null); });
  $("#pie").addEventListener("mouseleave", () => pieHover(null));
  $("#pie-legend").addEventListener("mouseover", (e) => { const r = e.target.closest(".pl-row"); pieHover(r ? r.dataset.i : null); });
  $("#pie-legend").addEventListener("mouseleave", () => pieHover(null));
  $("#modal").addEventListener("click", (e) => e.target.id === "modal" && closeModal());
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());
  $("#d-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sym = e.target.dataset.sym;
    const num = (id) => ($(id).value === "" ? null : Number($(id).value));
    const row = { user_id: S.user.id, symbol: sym, avg_cost_usd: num("#d-avg-usd"), avg_cost_brl: num("#d-avg-brl"), tv_symbol: $("#d-tv").value.trim() || null, hidden: $("#d-hidden").checked };
    const { error } = await sb.from("asset_settings").upsert(row);
    if (error) return alertMsg(error.message);
    S.settings[sym] = row;
    closeModal();
    renderAll();
  });

  ["#mov-wallet", "#mov-dir", "#mov-q"].forEach((s) => $(s).addEventListener("input", renderMovs));

  $("#w-kind").addEventListener("change", renderWalletForm);
  $("#wallet-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = $("#w-kind").value;
    const address = $("#w-address").value.trim();
    if (kind !== "binance" && !address) return alertMsg("Informe o endereço ou a chave pública.");
    if (kind === "evm" && !/^0x[0-9a-fA-F]{40}$/.test(address)) return alertMsg("Endereço EVM inválido (deve ser 0x seguido de 40 caracteres).");
    const networks = kind === "evm" ? [...document.querySelectorAll("#w-nets input:checked")].map((i) => i.value) : [];
    const { data, error } = await sb.from("wallets").insert({ kind, label: $("#w-label").value.trim(), address: kind === "binance" ? null : address, networks }).select().single();
    if (error) return alertMsg(error.message);
    e.target.reset();
    renderWalletForm();
    S.wallets.push(data);
    renderCadastros();
    runSync(data.id);
  });
  $("#wallet-list").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const w = S.wallets.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "sync") return runSync(w.id);
    if (b.dataset.act === "hist") return runHist(b);
    if (b.dataset.act === "csv") return $("#csv-file").click();
    if (b.dataset.act === "toggle") {
      await sb.from("wallets").update({ active: !w.active }).eq("id", w.id);
      w.active = !w.active;
      if (!w.active) await runSync("00000000-0000-0000-0000-000000000000");
      else await runSync(w.id);
    }
    if (b.dataset.act === "del") {
      if (!(await confirmBox(`Excluir a carteira "${w.label}"? Os saldos e movimentações dela saem do app.`))) return;
      await sb.from("wallets").delete().eq("id", w.id);
      await loadAll();
    }
  });

  $("#m-kind").addEventListener("change", manualFormLabels);
  $("#csv-file").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) await importBinanceCSV(files).catch((err) => alertMsg(`Erro no extrato: ${err.message}`));
  });
  $("#manual-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const num = (id) => ($(id).value === "" ? null : Number($(id).value));
    const kind = $("#m-kind").value;
    const row = {
      kind,
      symbol: $("#m-symbol").value.trim().toUpperCase().replace(/\.SA$/, ""),
      name: $("#m-name").value.trim() || null,
      quantity: num("#m-qty") ?? 0,
      avg_price: num("#m-avg"),
      currency: $("#m-ccy").value,
      current_value: kind === "b3" ? null : num("#m-cur"),
      notes: $("#m-notes").value.trim() || null,
    };
    const id = $("#m-id").value;
    if (id) {
      const { error } = await sb.from("manual_assets").update(row).eq("id", id);
      if (error) return alertMsg(error.message);
    } else {
      // nova compra/aplicação: cria o ativo (se ainda não existe) e a operação com data
      const date = $("#m-date").value;
      if (!date) return alertMsg("Informe a data da compra/aplicação.");
      if (!(row.avg_price > 0)) return alertMsg(kind === "b3" ? "Informe o preço pago por ação." : "Informe o valor aplicado.");
      const qtyOp = kind === "b3" ? row.quantity : 1;
      if (!(qtyOp > 0)) return alertMsg("Informe a quantidade.");
      let asset = S.manual.find((x) => x.kind === kind && x.symbol.toUpperCase() === row.symbol);
      if (!asset) {
        const { data, error } = await sb.from("manual_assets").insert({ ...row, quantity: 0, avg_price: null }).select().single();
        if (error) return alertMsg(error.message);
        asset = data;
        S.manual.push(asset);
      }
      const { error: e2 } = await sb.from("manual_ops").insert({ asset_id: asset.id, kind: $("#m-op").value, op_date: date, quantity: qtyOp, price: row.avg_price, fees: num("#m-fees") ?? 0 });
      if (e2) return alertMsg(e2.message);
      if (kind !== "b3" && row.current_value != null) await sb.from("manual_assets").update({ current_value: row.current_value }).eq("id", asset.id);
      const { data: ops } = await sb.from("manual_ops").select("*").order("op_date");
      S.ops = ops || [];
      await recalcAsset(asset.id);
    }
    resetManualForm();
    await loadAll();
  });
  $("#m-cancel").addEventListener("click", resetManualForm);
  $("#manual-list").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-mact]");
    if (!b) return;
    const a = S.manual.find((x) => x.id === b.dataset.id);
    if (b.dataset.mact === "ops") return openManual(a.id, "movs");
    if (b.dataset.mact === "del") {
      if (!(await confirmBox(`Excluir ${a.symbol}?`))) return;
      await sb.from("manual_assets").delete().eq("id", a.id);
      return loadAll();
    }
    $("#m-id").value = a.id;
    $("#m-kind").value = a.kind;
    $("#m-symbol").value = a.symbol;
    $("#m-name").value = a.name || "";
    $("#m-qty").value = a.quantity ?? 0;
    $("#m-avg").value = a.avg_price ?? "";
    $("#m-ccy").value = a.currency;
    $("#m-cur").value = a.current_value ?? "";
    $("#m-notes").value = a.notes || "";
    $("#m-title").textContent = `Editar ${a.symbol}`;
    $("#m-cancel").classList.remove("hidden");
    manualFormLabels();
    $("#manual-form").scrollIntoView({ behavior: "smooth" });
  });
}
function manualFormLabels() {
  const k = $("#m-kind").value, editing = !!$("#m-id").value;
  $("#m-qty-wrap").classList.toggle("hidden", k !== "b3");
  $("#m-avg-label").textContent = k === "b3" ? (editing ? "Preço médio" : "Preço por ação") : (editing ? "Valor aplicado" : "Valor aplicado");
  $("#m-cur-wrap").classList.toggle("hidden", k === "b3");
  $("#m-op-wrap").classList.toggle("hidden", editing);
  $("#m-date-wrap").classList.toggle("hidden", editing);
  $("#m-fees-wrap").classList.toggle("hidden", editing);
  $("#m-op").options[0].text = k === "b3" ? "Compra" : "Aplicação";
  $("#m-op").options[1].text = k === "b3" ? "Venda" : "Resgate";
}
function resetManualForm() {
  $("#manual-form").reset();
  $("#m-id").value = "";
  $("#m-title").textContent = "Adicionar compra ou aplicação";
  $("#m-cancel").classList.add("hidden");
  $("#m-date").value = new Date().toISOString().slice(0, 10);
  manualFormLabels();
}
function closeModal() {
  $("#modal").classList.add("hidden");
  evoChart?.remove();
  evoChart = null;
  $("#d-evo").innerHTML = "";
  $("#d-chart").innerHTML = "";
}
// avisos dentro da página (alert/confirm do navegador podem ser bloqueados)
function alertMsg(text) {
  const rep = $("#sync-report");
  rep.classList.remove("hidden");
  rep.innerHTML = `<div class="err">${esc(text)}</div>`;
  rep.scrollIntoView({ behavior: "smooth", block: "center" });
}
function confirmBox(text) {
  return new Promise((resolve) => {
    const d = document.createElement("div");
    d.className = "modal";
    d.innerHTML = `<div class="modal-card" style="max-width:420px"><p>${esc(text)}</p><div class="row-btns"><button class="btn danger" data-v="1">Excluir</button><button class="btn ghost" data-v="0">Cancelar</button></div></div>`;
    d.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b && e.target !== d) return;
      d.remove();
      resolve(b?.dataset.v === "1");
    });
    document.body.appendChild(d);
  });
}

const EYE_ON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';

// ------------------------------------------------------------------ login
async function start() {
  bind();
  renderWalletForm();
  resetManualForm();
  const { data } = await sb.auth.getSession();
  if (data.session) return enter(data.session.user);
  $("#login").classList.remove("hidden");
  const msg = $("#login-msg");
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "msg";
    msg.textContent = "Entrando…";
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#email").value, password: $("#password").value });
    if (error) {
      msg.className = "msg err";
      msg.textContent = error.message.includes("not confirmed") ? "Confirme o e-mail antes de entrar (veja sua caixa de entrada)." : "E-mail ou senha incorretos.";
      return;
    }
    enter(data.user);
  });
  $("#signup").addEventListener("click", async () => {
    if (!$("#login-form").reportValidity()) return;
    msg.className = "msg";
    msg.textContent = "Criando conta…";
    const { data, error } = await sb.auth.signUp({ email: $("#email").value, password: $("#password").value, options: { emailRedirectTo: location.href } });
    if (error) {
      msg.className = "msg err";
      msg.textContent = error.message;
      return;
    }
    if (data.session) return enter(data.user);
    msg.textContent = "Conta criada. Clique no link de confirmação que chegou no seu e-mail e depois entre aqui.";
  });
}
async function enter(user) {
  S.user = user;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  try {
    await loadAll();
  } catch (e) {
    alertMsg(`Não consegui carregar os dados: ${e.message}`);
  }
}
start();
