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
};
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
function money(v, ccy = S.ccy) {
  if (v == null || !isFinite(v)) return "—";
  return (ccy === "BRL" ? fBRL : fUSD).format(v);
}
function price(v, ccy) {
  if (v == null || !isFinite(v)) return "—";
  const d = v >= 1000 ? 2 : v >= 1 ? 2 : v >= 0.01 ? 4 : 8;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: ccy, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
function qty(v) {
  if (v == null) return "—";
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : 8;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(v);
}
function pct(v) {
  if (v == null || !isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2).replace(".", ",")}%`;
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
const icon = (sym) => `<span class="ico" style="background:${color(sym)}">${esc(sym.slice(0, 4))}</span>`;

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
function cryptoRows() {
  const map = new Map();
  for (const h of S.holdings) {
    const k = h.symbol;
    const r = map.get(k) || { sym: k, name: h.name, amount: 0, priceSync: null, parts: [], hasPrice: false };
    r.amount += Number(h.amount);
    if (h.price_usd != null) {
      r.priceSync = Number(h.price_usd);
      r.hasPrice = true;
    }
    if (!r.name && h.name) r.name = h.name;
    r.parts.push(h);
    map.set(k, r);
  }
  const rows = [...map.values()].map((r) => {
    const p = livePrice(r.sym, r.priceSync);
    const st = S.settings[r.sym] || {};
    return { ...r, price: p, value: p != null ? p * r.amount : null, ch: change24(r.sym), hidden: !!st.hidden, st };
  });
  return rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
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
    return { ...a, px, prev, valueBrl, costBrl, ch: px && prev ? (px - prev) / prev : null };
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
  const [w, h, m, st, tx, sn] = await Promise.all([
    sb.from("wallets").select("*").order("created_at"),
    sb.from("holdings").select("*"),
    sb.from("manual_assets").select("*").order("created_at"),
    sb.from("asset_settings").select("*"),
    sb.from("transactions").select("*").order("ts", { ascending: false }).limit(500),
    sb.from("snapshots").select("taken_at,total_usd,total_brl,usd_brl").order("taken_at").limit(5000),
  ]);
  for (const r of [w, h, m, st, tx, sn]) if (r.error) throw r.error;
  S.wallets = w.data;
  S.holdings = h.data;
  S.manual = m.data;
  S.settings = Object.fromEntries(st.data.map((s) => [s.symbol, s]));
  S.txs = tx.data;
  S.snaps = sn.data;
  const last = S.holdings.reduce((m, x) => (x.updated_at > m ? x.updated_at : m), "");
  $("#last-sync").textContent = last ? `Saldos atualizados ${ago(last)}` : "Ainda não sincronizado";
  connectLive();
  await loadQuotes();
  renderAll();
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
}

// ------------------------------------------------------------------ preços ao vivo (Binance)
let ws, wsSyms = "";
function connectLive() {
  const syms = new Set(["BTC", "ETH"]);
  for (const h of S.holdings) if (!STABLE.has(h.symbol) && h.price_usd != null) syms.add(h.symbol);
  const streams = [...syms].map((s) => `${s.toLowerCase()}usdt@miniTicker`);
  streams.push("usdtbrl@miniTicker");
  const key = streams.join("/");
  if (key === wsSyms && ws && ws.readyState <= 1) return;
  wsSyms = key;
  try { ws?.close(); } catch { /* */ }
  ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${key}`);
  ws.onmessage = (ev) => {
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
  const parts = [
    ["Cripto", toCcy(t.cryptoUsd), "#f7931a"],
    ["B3", brlToCcy(t.b3), "#0ea5e9"],
    ["Renda fixa", brlToCcy(t.rf), "#10b981"],
  ];
  if (t.out) parts.push(["Outros", brlToCcy(t.out), "#a78bfa"]);
  $("#alloc").innerHTML = parts
    .map(([n, v, c]) => {
      const p = main ? (v || 0) / main : 0;
      return `<div class="stat"><div class="muted">${n} <span class="small">${main ? (p * 100).toFixed(1).replace(".", ",") + "%" : ""}</span></div><div class="v">${money(v)}</div><div class="bar"><i style="width:${(p * 100).toFixed(1)}%;background:${c}"></i></div></div>`;
    })
    .join("");

  // tabela cripto
  const showSpam = $("#show-spam").checked;
  const rows = cryptoRows().filter((r) => showSpam || r.hasPrice || S.live[r.sym]);
  const ccy = S.ccy;
  const head = `<tr><th>Ativo</th><th>Preço</th><th>24h</th><th class="hide-sm">Quantidade</th><th>Valor</th><th class="hide-sm">% cart.</th><th class="hide-sm">Resultado</th></tr>`;
  const totalC = rows.filter((r) => !r.hidden).reduce((s, r) => s + (r.value || 0), 0);
  const body = rows
    .map((r) => {
      const pUsd = r.price;
      const pShown = ccy === "USD" ? pUsd : pUsd != null && rate() ? pUsd * rate() : null;
      const val = toCcy(r.value);
      let pnl = null;
      if (r.st.avg_cost_usd && pUsd != null) pnl = toCcy((pUsd - r.st.avg_cost_usd) * r.amount);
      else if (r.st.avg_cost_brl && pUsd != null && rate()) pnl = brlToCcy((pUsd * rate() - r.st.avg_cost_brl) * r.amount);
      const cost = r.st.avg_cost_usd ? toCcy(r.st.avg_cost_usd * r.amount) : r.st.avg_cost_brl ? brlToCcy(r.st.avg_cost_brl * r.amount) : null;
      const nets = [...new Set(r.parts.map((p) => NET[p.network] || p.network))].join(", ");
      const live = S.live[r.sym];
      const flash = live?.dir > 0 ? "flash-up" : live?.dir < 0 ? "flash-down" : "";
      if (live) live.dir = 0;
      return `<tr class="click ${r.hidden ? "dim" : ""}" data-sym="${esc(r.sym)}">
        <td><div class="asset">${icon(r.sym)}<div><div class="sym">${esc(r.sym)}</div><div class="nets-small">${esc(nets)}</div></div></div></td>
        <td><span class="price ${flash}">${price(pShown, ccy)}</span></td>
        <td><span class="pct ${cls(r.ch)}">${pct(r.ch)}</span></td>
        <td class="hide-sm">${qty(r.amount)}</td>
        <td><b>${money(val)}</b></td>
        <td class="hide-sm">${totalC && r.value && !r.hidden ? ((r.value / totalC) * 100).toFixed(1).replace(".", ",") + "%" : ""}</td>
        <td class="hide-sm">${pnl != null ? `<span class="${cls(pnl)}">${money(pnl)}</span><div class="nets-small">${cost ? pct(pnl / cost) : ""}</div>` : '<span class="muted small">informar preço médio</span>'}</td>
      </tr>`;
    })
    .join("");
  $("#crypto-table").innerHTML = head + (body || `<tr><td colspan="7" class="empty">Nenhum ativo ainda. Cadastre suas carteiras em <b>Cadastros</b> e clique em <b>Atualizar saldos</b>.</td></tr>`);

  // tabela manual
  const mr = manualRows();
  const kindName = { b3: "B3", renda_fixa: "Renda fixa", outro: "Outro" };
  $("#manual-table").innerHTML =
    `<tr><th>Ativo</th><th>Preço</th><th>Dia</th><th class="hide-sm">Quantidade</th><th>Valor</th><th class="hide-sm">Resultado</th></tr>` +
    (mr
      .map((a) => {
        const val = brlToCcy(a.valueBrl);
        const pnl = a.costBrl != null && a.valueBrl != null ? brlToCcy(a.valueBrl - a.costBrl) : null;
        const pxShown = a.px != null ? (S.ccy === "BRL" ? a.px : rate() ? a.px / rate() : null) : null;
        return `<tr class="${a.kind === "b3" ? "click" : ""}" data-b3="${a.kind === "b3" ? esc(a.symbol) : ""}">
          <td><div class="asset">${icon(a.symbol)}<div><div class="sym">${esc(a.symbol)}</div><div class="nets-small">${esc(a.name || kindName[a.kind])}</div></div></div></td>
          <td><span class="price">${a.kind === "b3" ? price(pxShown, S.ccy) : "—"}</span></td>
          <td><span class="pct ${cls(a.ch)}">${pct(a.ch)}</span></td>
          <td class="hide-sm">${a.kind === "b3" ? qty(Number(a.quantity)) : ""}</td>
          <td><b>${money(val)}</b></td>
          <td class="hide-sm">${pnl != null ? `<span class="${cls(pnl)}">${money(pnl)}</span><div class="nets-small">${a.costBrl ? pct((a.valueBrl - a.costBrl) / a.costBrl) : ""}</div>` : ""}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="6" class="empty">Cadastre ações, FIIs e renda fixa em <b>Cadastros</b>.</td></tr>`);
}

// gráfico do patrimônio
let chart, series;
function renderChart() {
  const el = $("#chart");
  if (!window.LightweightCharts) return;
  if (!chart) {
    chart = LightweightCharts.createChart(el, {
      layout: { background: { color: "transparent" }, textColor: "#8a9ab0", fontFamily: "Inter" },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1c2632" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      localization: { locale: "pt-BR", priceFormatter: (v) => money(v) },
      autoSize: true,
    });
    series = chart.addAreaSeries({ lineColor: "#10b981", topColor: "rgba(16,185,129,.35)", bottomColor: "rgba(16,185,129,0)", lineWidth: 2 });
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
function renderTape() {
  const top = cryptoRows().filter((r) => r.value && !STABLE.has(r.sym)).slice(0, 8).map((r) => ({ proName: tvSymbol(r.sym), title: r.sym }));
  const b3 = S.manual.filter((a) => a.kind === "b3").map((a) => ({ proName: a.tv_symbol || `BMFBOVESPA:${a.symbol.toUpperCase()}`, title: a.symbol.toUpperCase() }));
  const symbols = [...top, { proName: "BMFBOVESPA:IBOV", title: "Ibovespa" }, ...b3, { proName: "FX_IDC:USDBRL", title: "USD/BRL" }];
  if (!top.length) symbols.unshift({ proName: "BINANCE:BTCUSDT", title: "BTC" }, { proName: "BINANCE:ETHUSDT", title: "ETH" });
  tvWidget($("#tv-tape"), "ticker-tape", { symbols, showSymbolLogo: true, isTransparent: true, displayMode: "adaptive", colorTheme: "dark", locale: "br" });
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
  $("#d-title").textContent = sym;
  $("#d-tv-link").href = `https://br.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
  $("#d-form").classList.toggle("hidden", isB3);
  if (!isB3) {
    const r = cryptoRows().find((x) => x.sym === sym);
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
    ].map(([k, v]) => `<div class="stat"><div class="muted small">${k}</div><div class="v">${v}</div></div>`).join("");
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
  tvWidget($("#d-chart"), "advanced-chart", {
    autosize: true, symbol: tv, interval: "240", timezone: "America/Sao_Paulo", theme: "dark", style: "1",
    locale: "br", allow_symbol_change: true, hide_side_toolbar: false, calendar: false, support_host: "https://www.tradingview.com",
  });
  $("#modal").classList.remove("hidden");
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
  const dname = { in: "Entrada", out: "Saída", self: "Interna", trade: "Troca" };
  $("#movs-table").innerHTML =
    `<tr><th>Data</th><th>Tipo</th><th>Ativo</th><th>Quantidade</th><th class="hide-sm">Valor hoje</th><th class="hide-sm">Carteira</th><th class="hide-sm">Contraparte</th><th></th></tr>` +
    (list
      .map((t) => {
        const p = livePrice((t.symbol || "").toUpperCase(), prices[(t.symbol || "").toUpperCase()]);
        const v = p != null && t.amount != null ? toCcy(p * Number(t.amount)) : null;
        const cp = t.counterparty ? (t.counterparty.length > 26 ? t.counterparty.slice(0, 10) + "…" + t.counterparty.slice(-8) : t.counterparty) : "";
        return `<tr>
          <td>${t.ts ? new Date(t.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
          <td><span class="${t.direction === "in" ? "up" : t.direction === "out" ? "down" : ""}">${dname[t.direction] || t.direction}</span></td>
          <td><b>${esc(t.symbol || "")}</b> <span class="nets-small">${esc(NET[t.network] || t.network)}</span></td>
          <td>${qty(Number(t.amount))}</td>
          <td class="hide-sm">${money(v)}</td>
          <td class="hide-sm">${esc(t.source)}</td>
          <td class="hide-sm"><span class="nets-small" title="${esc(t.counterparty || "")}">${esc(cp)}</span></td>
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
          <div class="addr">${a.kind === "b3" ? `${qty(Number(a.quantity))} × ${price(Number(a.avg_price || 0), a.currency)}` : money(a.current_value ?? null, a.currency)}${a.notes ? " · " + esc(a.notes) : ""}</div></div>
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
  $("#fx").addEventListener("click", () => {
    S.fxSrc = S.fxSrc === "com" ? "usdt" : "com";
    store("fxSrc", S.fxSrc);
    renderFx();
    renderAll();
  });
  $("#show-spam").addEventListener("change", renderPainel);
  $("#sync").addEventListener("click", () => runSync());
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  $("#crypto-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-sym]");
    if (tr) openAsset(tr.dataset.sym);
  });
  $("#manual-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-b3]");
    if (tr && tr.dataset.b3) openAsset(tr.dataset.b3, true);
  });
  $("#d-close").addEventListener("click", closeModal);
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

  $("#m-kind").addEventListener("change", () => $("#m-cur-wrap").classList.toggle("hidden", $("#m-kind").value === "b3"));
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
    const { error } = id ? await sb.from("manual_assets").update(row).eq("id", id) : await sb.from("manual_assets").insert(row);
    if (error) return alertMsg(error.message);
    resetManualForm();
    await loadAll();
  });
  $("#m-cancel").addEventListener("click", resetManualForm);
  $("#manual-list").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-mact]");
    if (!b) return;
    const a = S.manual.find((x) => x.id === b.dataset.id);
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
    $("#m-cur-wrap").classList.toggle("hidden", a.kind === "b3");
    $("#manual-form").scrollIntoView({ behavior: "smooth" });
  });
}
function resetManualForm() {
  $("#manual-form").reset();
  $("#m-id").value = "";
  $("#m-title").textContent = "Adicionar ativo";
  $("#m-cancel").classList.add("hidden");
  $("#m-cur-wrap").classList.add("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
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

// ------------------------------------------------------------------ login
async function start() {
  bind();
  renderWalletForm();
  $("#m-cur-wrap").classList.add("hidden");
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
