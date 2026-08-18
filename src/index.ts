import { app } from "./lib/agent.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 3004;
const host = "127.0.0.1";

const server = app.listen(port, host, () => {
  console.log(`Gloria Lucid Agent running on ${host}:${port}`);
  console.log(`AgentCard: http://${host}:${port}/.well-known/agent-card.json`);
  console.log(`Entrypoints: news, recaps, search, ticker-summary`);
});

export default server;
