import * as dotenv from "dotenv";
import { Keypair } from "@solana/web3.js";

dotenv.config();

function getKeypairFromEnv(): Keypair {
  const raw = process.env.WALLET_PRIVATE_KEY;
  if (!raw) throw new Error("WALLET_PRIVATE_KEY not set in .env");
  const parsed = JSON.parse(raw);
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

export const CONFIG = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  solanaWssUrl: process.env.SOLANA_WSS_URL || "wss://api.devnet.solana.com",
  walletKeypair: getKeypairFromEnv(),
  geyserEndpoint: process.env.GEYSER_ENDPOINT || "",
  geyserToken: process.env.GEYSER_TOKEN || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  jitoBlockEngineUrl:
    process.env.JITO_BLOCK_ENGINE_URL ||
    "dallas.testnet.block-engine.jito.wtf",
};

export const JITO_TIP_ACCOUNTS = [
  "F7ThiQUBYiEcyaxpmMuUeACdoiSLKg4SZZ8JSfpFNwAf",
  "4uRnem4BfVpZBv7kShVxUYtcipscgZMSHi3B9CSL6gAA",
  "84DrGKhycCUGfLzw8hXsUYX9SnWdh2wW3ozsTPrC5xyg",
  "CwWZzvRgmxj9WLLhdoWUVrHZ1J8db3w2iptKuAitHqoC",
  "BkMx5bRzQeP6tUZgzEs3xeDWJfQiLYvNDqSgmGZKYJDq",
  "G2d63CEgKBdgtpYT2BuheYQ9HFuFCenuHLNyKVpqAuSD",
  "7aewvu8fMf1DK4fKoMXKfs3h3wpAQ7r7D8T1C71LmMF",
  "AzfhMPcx3qjbvCK3UUy868qmc5L451W341cpFqdL3EBe",
];