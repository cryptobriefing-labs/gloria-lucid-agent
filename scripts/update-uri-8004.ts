/**
 * Updates the on-chain agentURI for Gloria's ERC-8004 registration.
 *
 * Prerequisites:
 *   - Set PRIVATE_KEY in .env (same wallet that registered, 0xCa12...)
 *
 * Usage:
 *   npx tsx scripts/update-uri-8004.ts
 */

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const AGENT_ID = 18095n;
const NEW_URI = "https://lucid.itsgloria.ai/.well-known/agent-registration.json";

const abi = parseAbi([
  "function setAgentURI(uint256 agentId, string agentURI) external",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY in .env (hex string with 0x prefix)");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Wallet: ${account.address}`);

  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  // Show current URI
  const currentUri = await publicClient.readContract({
    address: IDENTITY_REGISTRY, abi, functionName: "tokenURI", args: [AGENT_ID],
  });
  console.log(`Current URI: ${currentUri}`);
  console.log(`New URI:     ${NEW_URI}`);

  console.log("Sending setAgentURI() transaction...");
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY, abi, functionName: "setAgentURI", args: [AGENT_ID, NEW_URI],
  });

  console.log(`Transaction hash: ${hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Verify
  const updatedUri = await publicClient.readContract({
    address: IDENTITY_REGISTRY, abi, functionName: "tokenURI", args: [AGENT_ID],
  });
  console.log(`Verified on-chain URI: ${updatedUri}`);
}

main().catch(console.error);
