# Gloria Lucid Agent

AI-powered crypto news intelligence, deployed as a [Lucid](https://github.com/daydreamsai/lucid) agent with [x402](https://www.x402.org/) micropayments on Base.

**Live:** https://lucid.itsgloria.ai

## Entrypoints

| Entrypoint | Description | Price (USDC) |
|---|---|---|
| `news` | Latest curated crypto news by category | $0.03 |
| `recaps` | AI-generated news recap for a category | $0.10 |
| `search` | Keyword search across curated news | $0.05 |
| `ticker-summary` | 24h AI-generated summary for a token/ticker | $0.031 |

All entrypoints are gated by x402 micropayments (USDC on Base).

## Categories

ai, ai_agents, base, bitcoin, crypto, dats, defi, ethereum, hyperliquid, machine_learning, macro, perps, rwa, ripple, solana, tech

## Discovery

- **Agent Card:** https://lucid.itsgloria.ai/.well-known/agent-card.json
- **ERC-8004:** [Agent #18095 on Base](https://8004scan.com/agents/base/18095)
- **Registration:** https://lucid.itsgloria.ai/.well-known/agent-registration.json

## Setup

```bash
cp .env.example .env
# Fill in GLORIA_API_URL and GLORIA_API_TOKEN_DEV
npm install
npm start
```

## Environment Variables

| Variable | Description |
|---|---|
| `GLORIA_API_URL` | Gloria backend API URL |
| `GLORIA_API_TOKEN_DEV` | API authentication token |
| `PAYMENTS_FACILITATOR_URL` | x402 facilitator endpoint |
| `PAYMENTS_RECEIVABLE_ADDRESS` | Wallet address for receiving payments |
| `PAYMENTS_NETWORK` | Payment network (e.g. `eip155:8453` for Base) |
| `PRICE_NEWS` | Price for news entrypoint (USDC base units, 6 decimals) |
| `PRICE_RECAP` | Price for recaps entrypoint |
| `PRICE_SEARCH` | Price for search entrypoint |
| `PRICE_TICKER_SUMMARY` | Price for ticker-summary entrypoint |

## License

MIT
