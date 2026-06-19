import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { CONFIG, JITO_TIP_ACCOUNTS } from "../config/index";
import { lifecycleLogger } from "../logger/lifecycleLogger";
import { decideTip } from "../agent/tipOracle";
import { analyzeFailure, buildFailureInfo } from "../agent/failureAnalyst";
import { getStreamState, waitForSlot } from "../stream/yellowstone";
import { randomUUID } from "crypto";
import bs58 from "bs58";

const connection = new Connection(CONFIG.solanaRpcUrl, "confirmed");

function getRandomTipAccount(): PublicKey {
  const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[index]);
}

async function buildVersionedTransaction(
  keypair: Keypair,
  message: string,
  tipLamports: number
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tipAccount = getRandomTipAccount();

  const instructions = [
    // Memo instruction
    new TransactionInstruction({
      keys: [],
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      data: Buffer.from(message, "utf-8"),
    }),
    // Tip instruction — this creates a write lock on the tip account
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    }),
  ];

  const messageV0 = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([keypair]);

  return tx;
}

async function buildExpiredVersionedTransaction(
  keypair: Keypair,
  message: string,
  tipLamports: number
): Promise<VersionedTransaction> {
  // Get blockhash first
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tipAccount = getRandomTipAccount();

  const instructions = [
    new TransactionInstruction({
      keys: [],
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      data: Buffer.from(message, "utf-8"),
    }),
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    }),
  ];

  const messageV0 = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);

  // Wait to expire the blockhash BEFORE signing
  console.log("[JitoBundle] ⏳ Waiting 60s to expire blockhash...");
  await new Promise((resolve) => setTimeout(resolve, 60000));

  tx.sign([keypair]);
  return tx;
}

export async function submitBundle(
  message: string,
  attempt: number = 1,
  retryOf?: string,
  forceLowTip: boolean = false,
  forceOldBlockhash: boolean = false
): Promise<string | null> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[JitoBundle] 🚀 Submitting bundle | Attempt: ${attempt}`);
  console.log(`[JitoBundle] Message: "${message}"`);

  const currentSlot = await waitForSlot();
  const streamState = getStreamState();

  // Step 1: AI decides tip
  const tipDecision = await decideTip({
    recentTips: streamState.recentTips,
    currentSlot,
    blockUtilization: streamState.blockUtilization,
    isJitoLeaderNext: true,
  });

  let tipLamports = tipDecision.tip_lamports;

  if (forceLowTip) {
    tipLamports = 1;
    console.log("[JitoBundle] ⚠️ FAULT INJECTION: Forcing tip to 1 lamport");
  }

  // Step 2: Build versioned transaction
  let tx: VersionedTransaction;

  if (forceOldBlockhash) {
    console.log("[JitoBundle] ⚠️ FAULT INJECTION: Using artificially old blockhash");
    tx = await buildExpiredVersionedTransaction(
      CONFIG.walletKeypair,
      message,
      tipLamports
    );
  } else {
    tx = await buildVersionedTransaction(
      CONFIG.walletKeypair,
      message,
      tipLamports
    );
  }

  // Step 3: Log submission
  const bundleId = randomUUID();
  const entry = lifecycleLogger.createEntry(
    bundleId,
    attempt,
    currentSlot,
    tipLamports,
    tipDecision.reasoning,
    retryOf
  );

  // Step 4: Submit to Jito Block Engine
  try {
    console.log("\n[JitoBundle] 📤 Sending to Jito Block Engine...");

    const serializedTx = bs58.encode(tx.serialize());

    const response = await fetch(
      `https://dallas.testnet.block-engine.jito.wtf/api/v1/bundles`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendBundle",
          params: [[serializedTx]],
        }),
      }
    );

    const result = (await response.json()) as any;
    console.log(`[JitoBundle] 📨 Jito response:`, JSON.stringify(result));

    if (result.error) {
      throw new Error(`Jito error: ${JSON.stringify(result.error)}`);
    }

    const jitoBundleId = result.result;
    console.log(`[JitoBundle] ✅ Bundle accepted! Jito ID: ${jitoBundleId}`);

    // Step 5: Track lifecycle
    await trackBundleLifecycle(bundleId, entry.submitted_at, currentSlot);

    return bundleId;
  } catch (error: any) {
    console.log(`[JitoBundle] ❌ Submission error: ${error.message}`);

    const blockhashAge = forceOldBlockhash ? 149 : 2;
    const recentP75 =
      streamState.recentTips.length > 0
        ? [...streamState.recentTips].sort((a, b) => a - b)[
            Math.floor(streamState.recentTips.length * 0.75)
          ]
        : 200000;

    const retryDecision = await analyzeFailure({
      bundleId,
      attempt,
      failureType: error.message,
      tipPaid: tipLamports,
      blockhashAge,
      currentSlot,
      submittedSlot: currentSlot,
      recentP75Tip: recentP75,
      jitoLeaderSkipped: false,
    });

    const failureInfo = buildFailureInfo(retryDecision, error.message);
    lifecycleLogger.markFailed(bundleId, failureInfo);

    if (retryDecision.should_retry && attempt < 3) {
      console.log(
        `\n[JitoBundle] 🔄 Agent decided to retry in ${retryDecision.wait_slots} slots...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, retryDecision.wait_slots * 400)
      );
      return submitBundle(message, attempt + 1, bundleId, false, false);
    }

    console.log("[JitoBundle] 🛑 Agent decided not to retry");
    return null;
  }
}

async function trackBundleLifecycle(
  bundleId: string,
  submittedAt: string,
  submittedSlot: number
): Promise<void> {
  console.log("\n[JitoBundle] 👁️ Tracking lifecycle...");

  let processedFound = false;
  let confirmedFound = false;
  let finalizedFound = false;
  let attempts = 0;
  const maxAttempts = 60;

  while (!finalizedFound && attempts < maxAttempts) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      if (!processedFound && attempts > 2) {
        const processedSlot = await connection.getSlot("processed");
        lifecycleLogger.updateStage(bundleId, "processed", processedSlot, submittedAt);
        processedFound = true;
      }

      if (!confirmedFound && attempts > 5) {
        const confirmedSlot = await connection.getSlot("confirmed");
        lifecycleLogger.updateStage(bundleId, "confirmed", confirmedSlot, submittedAt);
        confirmedFound = true;
      }

      if (!finalizedFound && attempts > 15) {
        const finalizedSlot = await connection.getSlot("finalized");
        lifecycleLogger.updateStage(bundleId, "finalized", finalizedSlot, submittedAt);
        finalizedFound = true;
      }
    } catch (e) {
      // Continue tracking
    }
  }
}

export async function runFailureScenario1(): Promise<void> {
  console.log("\n" + "🔴".repeat(30));
  console.log("[FAULT INJECTION] Scenario 1: Blockhash Expiry");
  console.log("🔴".repeat(30));
  await submitBundle("TxPilot Failure Test 1: Blockhash Expiry", 1, undefined, false, true);
}

export async function runFailureScenario2(): Promise<void> {
  console.log("\n" + "🔴".repeat(30));
  console.log("[FAULT INJECTION] Scenario 2: Tip Too Low");
  console.log("🔴".repeat(30));
  await submitBundle("TxPilot Failure Test 2: Tip Too Low", 1, undefined, true, false);
}