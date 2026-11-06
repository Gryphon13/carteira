# Carteira

Painel pessoal de investimentos: cripto (Bitcoin/Trezor, MetaMask e redes EVM, BSC, Cardano, Polkadot, Binance), B3 e renda fixa, em reais e em dólar, com preços ao vivo e gráficos do TradingView.

- **Página** (`index.html`, `app.js`, `style.css`): publicada pelo GitHub Pages.
- **Servidor** (`supabase/functions`): funções do Supabase que leem saldos e movimentações (`sync`) e cotações da B3 e do dólar (`quotes`).

Nada sensível fica neste repositório: endereços das carteiras ficam no banco do Supabase (protegidos por login) e as chaves de API ficam nos segredos das Edge Functions.

## Fontes de dados

| O quê | De onde |
|---|---|
| Bitcoin (zpub/xpub/descritor ou endereço) | mempool.space |
| MetaMask / EVM (Ethereum, BSC, Polygon, Arbitrum, Base, Optimism…) | Alchemy |
| Polkadot (rede principal + Asset Hub) | Subscan |
| Cardano | Koios |
| Binance (Spot, Funding, Earn, depósitos e saques) | API da Binance, chave só de leitura |
| Preços cripto ao vivo e USDT/BRL | WebSocket público da Binance |
| B3 (atraso ~15 min) e dólar comercial | Yahoo Finance |
| Gráficos | Widgets do TradingView |

## Segredos necessários (Supabase → Edge Functions → Secrets)

`ALCHEMY_API_KEY`, `SUBSCAN_API_KEY`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`
