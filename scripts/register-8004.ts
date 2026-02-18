/**
 * ERC-8004 Agent Registration Script
 *
 * Registers Gloria on the ERC-8004 Identity Registry on Base mainnet.
 * This mints an ERC-721 NFT representing Gloria's on-chain identity,
 * making it discoverable on 8004scan.io.
 *
 * Prerequisites:
 *   - Set PRIVATE_KEY in .env (wallet with some ETH on Base for gas)
 *   - The agent registration JSON must be live at the agentURI
 *
 * Usage:
 *   npx tsx scripts/register-8004.ts
 */

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const AGENT_URI = "http://lucid.itsgloria.ai:3004/.well-known/agent-registration.json";

const abi = parseAbi([
  "function register(string agentURI) external returns (uint256 agentId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY in .env (hex string with 0x prefix)");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Registering from wallet: ${account.address}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(),
  });

  console.log(`Agent URI: ${AGENT_URI}`);
  console.log(`Contract: ${IDENTITY_REGISTRY}`);
  console.log(`Chain: Base (8453)`);
  console.log("Sending register() transaction...");

  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: "register",
    args: [AGENT_URI],
  });

  console.log(`Transaction hash: ${hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Extract agentId from Transfer event
  const transferLog = receipt.logs.find(
    (log) => log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  );

  if (transferLog && transferLog.topics[3]) {
    const agentId = BigInt(transferLog.topics[3]);
    console.log(`\nRegistration successful!`);
    console.log(`Agent ID: ${agentId}`);
    console.log(`View on 8004scan: https://www.8004scan.io/agents/${agentId}`);
    console.log(`\nNext step: Update the registrations array in agent.ts with:`);
    console.log(`  agentId: ${agentId}`);
    console.log(`  agentRegistry: "eip155:8453:${IDENTITY_REGISTRY}"`);
  } else {
    console.log("Transaction confirmed but could not extract agentId from logs.");
    console.log("Check the transaction on BaseScan:", `https://basescan.org/tx/${hash}`);
  }
}

main().catch(console.error);
