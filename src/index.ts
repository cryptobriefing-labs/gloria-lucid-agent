import { app } from "./lib/agent.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 3004;

const server = app.listen(port, () => {
  console.log(`Gloria Lucid Agent running on port ${port}`);
  console.log(`AgentCard: http://localhost:${port}/.well-known/agent-card.json`);
  console.log(`Entrypoints: news, recaps, search, ticker-summary`);
});

export default server;
