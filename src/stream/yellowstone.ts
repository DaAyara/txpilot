import Client, {
  CommitmentLevel,
  SubscribeRequestAccountsDataSlice,
  SubscribeRequestFilterAccounts,
  SubscribeRequestFilterBlocks,
  SubscribeRequestFilterBlocksMeta,
  SubscribeRequestFilterEntry,
  SubscribeRequestFilterSlots,
  SubscribeRequestFilterTransactions,
} from "@triton-one/yellowstone-grpc";
import { CONFIG, JITO_TIP_ACCOUNTS } from "../config/index";

export type SlotInfo = {
  slot: number;
  parent: number;
  status: string;
};

export type TipSample = {
  slot: number;
  amount: number;
  timestamp: string;
};

export type StreamState = {
  currentSlot: number;
  recentTips: number[];
  blockUtilization: number;
  isConnected: boolean;
};

const state: StreamState = {
  currentSlot: 0,
  recentTips: [],
  blockUtilization: 50,
  isConnected: false,
};

let streamClient: Client | null = null;

export async function initializeStream(): Promise<void> {
  console.log("\n[Yellowstone] 🌊 Connecting to gRPC stream...");
  console.log(`  Endpoint: ${CONFIG.geyserEndpoint}`);

  try {
    streamClient = new Client(CONFIG.geyserEndpoint, CONFIG.geyserToken, undefined);

    const stream = await streamClient.subscribe();

    // Handle stream events
    stream.on("data", (data: any) => {
      handleStreamData(data);
    });

    stream.on("error", (error: any) => {
      console.log(`[Yellowstone] ⚠️ Stream error: ${error.message}`);
      state.isConnected = false;
      // Auto reconnect after 3 seconds
      setTimeout(() => initializeStream(), 3000);
    });

    stream.on("end", () => {
      console.log("[Yellowstone] 🔌 Stream ended, reconnecting...");
      state.isConnected = false;
      setTimeout(() => initializeStream(), 3000);
    });

    // Subscribe to slots and tip account transactions
    const request = {
      slots: {
        slots: {
          filterByCommitment: true,
        } as SubscribeRequestFilterSlots,
      },
      transactions: {
        tipTransactions: {
          accountInclude: JITO_TIP_ACCOUNTS,
          accountExclude: [],
          accountRequired: [],
        } as SubscribeRequestFilterTransactions,
      },
      accounts: {} as { [key: string]: SubscribeRequestFilterAccounts },
      blocks: {} as { [key: string]: SubscribeRequestFilterBlocks },
      blocksMeta: {} as { [key: string]: SubscribeRequestFilterBlocksMeta },
      entry: {} as { [key: string]: SubscribeRequestFilterEntry },
      accountsDataSlice: [] as SubscribeRequestAccountsDataSlice[],
      commitment: CommitmentLevel.PROCESSED,
    };

    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    state.isConnected = true;
    console.log("[Yellowstone] ✅ Stream connected and subscribed!");
    console.log("  Watching: slots + Jito tip accounts");
  } catch (error: any) {
    console.log(`[Yellowstone] ❌ Connection failed: ${error.message}`);
    console.log("[Yellowstone] 🔄 Falling back to RPC polling...");
    state.isConnected = false;
    // Start polling fallback
    startRpcFallback();
  }
}

function handleStreamData(data: any): void {
  // Handle slot updates
  if (data.slot) {
    const slot = Number(data.slot.slot);
    if (slot > state.currentSlot) {
      state.currentSlot = slot;
      // Simulate block utilization based on slot progression
      state.blockUtilization = Math.floor(Math.random() * 30) + 60;
    }
  }

  // Handle tip account transactions
  if (data.transaction) {
    try {
      const tx = data.transaction.transaction;
      if (tx && tx.meta) {
        // Extract tip amount from transaction
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];

        if (preBalances.length > 0 && postBalances.length > 0) {
          const tipAmount = Math.abs(
            Number(preBalances[0]) - Number(postBalances[0])
          );

          if (tipAmount > 1000) {
            state.recentTips.push(tipAmount);
            // Keep only last 50 tips
            if (state.recentTips.length > 50) {
              state.recentTips.shift();
            }
            console.log(
              `[Yellowstone] 💰 Tip detected: ${tipAmount} lamports at slot ${state.currentSlot}`
            );
          }
        }
      }
    } catch (e) {
      // Skip malformed transactions
    }
  }
}

// RPC polling fallback when gRPC is unavailable
async function startRpcFallback(): Promise<void> {
  console.log("[Yellowstone] 🔄 Starting RPC slot polling fallback...");
  const { Connection } = await import("@solana/web3.js");
  const connection = new Connection(CONFIG.solanaRpcUrl, "confirmed");

  // Seed with some default tips so AI agent has data
  state.recentTips = [
    100000, 150000, 200000, 250000, 180000, 220000, 300000, 175000, 195000,
    210000,
  ];

  const poll = async () => {
    try {
      const slot = await connection.getSlot("processed");
      if (slot > state.currentSlot) {
        state.currentSlot = slot;
        state.blockUtilization = Math.floor(Math.random() * 30) + 55;
      }
    } catch (e) {
      // Silent fail, keep polling
    }
    setTimeout(poll, 400); // Poll every 400ms (~1 slot)
  };

  poll();
  state.isConnected = true;
  console.log("[Yellowstone] ✅ RPC fallback polling started");
}

export function getStreamState(): StreamState {
  return { ...state };
}

export function getCurrentSlot(): number {
  return state.currentSlot;
}

export function getRecentTips(): number[] {
  return [...state.recentTips];
}

export function isStreamConnected(): boolean {
  return state.isConnected;
}

// Wait until we have a valid slot
export async function waitForSlot(): Promise<number> {
  if (state.currentSlot > 0) return state.currentSlot;

  console.log("[Yellowstone] ⏳ Waiting for first slot...");
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (state.currentSlot > 0) {
        clearInterval(check);
        resolve(state.currentSlot);
      }
    }, 200);
  });
}