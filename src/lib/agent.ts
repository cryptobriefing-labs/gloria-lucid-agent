import "dotenv/config";
import { z } from "zod";
import { createAgent } from "@lucid-agents/core";
import { createAgentApp } from "@lucid-agents/express";
import { http } from "@lucid-agents/http";
import { a2a } from "@lucid-agents/a2a";
import {
  payments,
  paymentsFromEnv,
  createInMemoryPaymentStorage,
} from "@lucid-agents/payments";

const GLORIA_API_URL = process.env.GLORIA_API_URL;
const GLORIA_API_TOKEN = process.env.GLORIA_API_TOKEN_DEV;

const CATEGORIES =
  "ai, ai_agents, base, bitcoin, crypto, dats, defi, ethereum, hyperliquid, machine_learning, macro, perps, rwa, ripple, solana, tech";

const CATEGORIES_24H = [
  "base",
  "hyperliquid",
  "ripple",
  "ethereum",
  "rwa",
  "ondo",
  "solana",
  "aptos",
  "perps",
  "dats",
];

// --- Zod schemas ---

const newsItemSchema = z.object({
  id: z.string(),
  signal: z.string(),
  sentiment: z.string(),
  sentiment_value: z.number(),
  timestamp: z.number(),
  feed_categories: z.array(z.string()),
  short_context: z.string(),
  long_context: z.string(),
  sources: z.array(z.string()),
  author: z.string(),
  tokens: z.array(z.string()),
  tweet_url: z.string(),
});

const newsInputSchema = z.object({
  feed_categories: z
    .string()
    .describe(
      `Comma-separated list of feed categories. Available: ${CATEGORIES}`
    ),
  from_date: z
    .string()
    .optional()
    .describe("Start date (YYYY-MM-DD format)"),
  to_date: z
    .string()
    .optional()
    .describe("End date (YYYY-MM-DD format)"),
});

const newsOutputSchema = z.object({
  items: z.array(newsItemSchema),
});

const recapInputSchema = z.object({
  feed_category: z
    .string()
    .describe(
      `Feed category. Available: ${CATEGORIES}`
    ),
});

const recapOutputSchema = z.object({
  feed_category: z.string(),
  timeframe: z.string(),
  recap: z.string(),
  created_at: z.string(),
});

const searchInputSchema = z.object({
  keyword: z.string().describe("The keyword to search for"),
});

const searchOutputSchema = z.object({
  items: z.array(newsItemSchema),
});

const tickerSummaryInputSchema = z.object({
  ticker: z
    .string()
    .describe("Token symbol or name (e.g. ZRO, LayerZero, SOL, Solana)"),
});

const tickerSummaryOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      "Bullet-point summary of the most important developments for the ticker over the last 24 hours"
    ),
});

// --- Gloria API helper ---

async function gloriaFetch(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  if (!GLORIA_API_URL || !GLORIA_API_TOKEN) {
    throw new Error(
      "GLORIA_API_URL and GLORIA_API_TOKEN_DEV must be set in .env"
    );
  }

  const url = new URL(path, GLORIA_API_URL);
  url.searchParams.set("token", GLORIA_API_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gloria API ${res.status}: ${body}`);
  }

  return res.json();
}

// --- Build agent runtime ---

const paymentsConfig = paymentsFromEnv();

const runtime = await createAgent({
  name: process.env.AGENT_NAME || "Gloria",
  version: process.env.AGENT_VERSION || "1.0.0",
  description:
    process.env.AGENT_DESCRIPTION ||
    "AI-powered crypto news intelligence. Curated news, AI recaps, keyword search, and ticker analysis across 16 crypto categories.",
})
  .use(http())
  .use(a2a())
  .use(
    payments({
      config: paymentsConfig,
      storageFactory: () => createInMemoryPaymentStorage(),
    })
  )
  .build();

const { app, addEntrypoint } = await createAgentApp(runtime);

// --- ERC-8004 registration endpoint ---

app.get("/.well-known/agent-registration.json", (_req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Gloria",
    description:
      "AI-powered crypto news intelligence. Curated news, AI recaps, keyword search, and ticker analysis across 16 crypto categories including Bitcoin, Ethereum, DeFi, AI, Solana, and more.",
    image: "https://itsgloria.ai/gloria-logo.png",
    services: [
      {
        name: "A2A",
        endpoint:
          "http://lucid.itsgloria.ai:3004/.well-known/agent-card.json",
        version: "1.0",
      },
      {
        name: "web",
        endpoint: "https://itsgloria.ai/",
      },
    ],
    x402Support: true,
    active: true,
    registrations: [],
    updatedAt: Math.floor(Date.now() / 1000),
    supportedTrust: ["reputation"],
  });
});

// --- Entrypoints ---

addEntrypoint({
  key: "news",
  description:
    "Get the latest curated crypto news by category. Returns the 10 most recent headlines with sentiment, context, and sources.",
  input: newsInputSchema,
  output: newsOutputSchema,
  price: process.env.PRICE_NEWS || "30000",
  handler: async (ctx) => {
    const { feed_categories, from_date, to_date } = ctx.input as z.infer<
      typeof newsInputSchema
    >;

    const data = await gloriaFetch("/news", {
      feed_categories,
      from_date: from_date || "2025-05-01",
      to_date: to_date || new Date().toISOString().split("T")[0],
      page: "1",
      limit: "10",
    });

    const items = Array.isArray(data) ? data : [];
    return { output: { items } };
  },
});

addEntrypoint({
  key: "recaps",
  description:
    "Get an AI-generated news recap/summary for a specific crypto category over the past 12-24 hours.",
  input: recapInputSchema,
  output: recapOutputSchema,
  price: process.env.PRICE_RECAP || "100000",
  handler: async (ctx) => {
    const { feed_category } = ctx.input as z.infer<typeof recapInputSchema>;

    const timeframe = CATEGORIES_24H.includes(feed_category) ? "24h" : "12h";

    const data = (await gloriaFetch("/recaps", {
      feed_category,
      timeframe,
    })) as z.infer<typeof recapOutputSchema>;

    return { output: data };
  },
});

addEntrypoint({
  key: "search",
  description:
    "Search curated crypto news by keyword. Returns the 10 most recent matching headlines.",
  input: searchInputSchema,
  output: searchOutputSchema,
  price: process.env.PRICE_SEARCH || "50000",
  handler: async (ctx) => {
    const { keyword } = ctx.input as z.infer<typeof searchInputSchema>;

    const data = await gloriaFetch("/news", {
      keyword,
      page: "1",
      limit: "10",
    });

    const items = Array.isArray(data) ? data : [];
    return { output: { items } };
  },
});

addEntrypoint({
  key: "ticker-summary",
  description:
    "Get a 24-hour AI-generated news summary for a specific token/ticker, combining internal news data with web search. Returns decision-grade bullet points for fund managers and trading agents.",
  input: tickerSummaryInputSchema,
  output: tickerSummaryOutputSchema,
  price: process.env.PRICE_TICKER_SUMMARY || "31000",
  handler: async (ctx) => {
    const { ticker } = ctx.input as z.infer<typeof tickerSummaryInputSchema>;

    const data = (await gloriaFetch("/news-ticker-summary", {
      ticker,
    })) as z.infer<typeof tickerSummaryOutputSchema>;

    return { output: data };
  },
});

export { app };
