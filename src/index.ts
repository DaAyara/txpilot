import { initializeStream, waitForSlot, getStreamState } from "./stream/yellowstone";
import { submitBundle, runFailureScenario1, runFailureScenario2 } from "./bundle/jitoBundle";
import { lifecycleLogger } from "./logger/lifecycleLogger";
import { CONFIG } from "./config/index";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runNormalBundles(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("📦 PHASE 1: Normal Bundle Submissions");
  console.log("=".repeat(60));

  const messages = [
    "TxPilot Bundle #1 - Network Health Check",
    "TxPilot Bundle #2 - Tip Oracle Test",
    "TxPilot Bundle #3 - Lifecycle Tracking",
    "TxPilot Bundle #4 - Stream Validation",
    "TxPilot Bundle #5 - AI Decision Log",
    "TxPilot Bundle #6 - Commitment Tracking",
    "TxPilot Bundle #7 - Slot Monitoring",
    "TxPilot Bundle #8 - Block Utilization",
  ];

  for (let i = 0; i < messages.length; i++) {
    console.log(`\n[Main] Submitting bundle ${i + 1} of ${messages.length}`);
    await submitBundle(messages[i]);
    
    // Wait between submissions to avoid rate limits
    if (i < messages.length - 1) {
      console.log("[Main] ⏳ Waiting 5s before next bundle...");
      await sleep(5000);
    }
  }
}

async function runFailureScenarios(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("🔴 PHASE 2: Engineered Failure Scenarios");
  console.log("=".repeat(60));

  // Failure 1: Low tip (fast, no waiting)
  console.log("\n[Main] Running Failure Scenario 2: Tip Too Low");
  await runFailureScenario2();
  await sleep(5000);

  // Failure 2: Blockhash expiry (takes ~60s due to intentional wait)
  console.log("\n[Main] Running Failure Scenario 1: Blockhash Expiry");
  console.log("[Main] ⚠️ This scenario takes ~60 seconds intentionally");
  await runFailureScenario1();
}

async function printFinalSummary(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(60));

  const summary = lifecycleLogger.getSummary();
  const entries = lifecycleLogger.getEntries();

  console.log("\n📋 Bundle Details:");
  entries.forEach((entry, i) => {
    console.log(`\n  [${i + 1}] Bundle: ${entry.bundle_id.slice(0, 16)}...`);
    console.log(`      Attempt: ${entry.attempt}`);
    console.log(`      Outcome: ${entry.outcome}`);
    console.log(`      Tip: ${entry.tip_lamports} lamports`);
    console.log(`      Submitted slot: ${entry.submitted_slot}`);

    if (entry.stages.processed) {
      console.log(`      Processed: slot ${entry.stages.processed.slot} (+${entry.stages.processed.delta_ms}ms)`);
    }
    if (entry.stages.confirmed) {
      console.log(`      Confirmed: slot ${entry.stages.confirmed.slot} (+${entry.stages.confirmed.delta_ms}ms)`);
    }
    if (entry.stages.finalized) {
      console.log(`      Finalized: slot ${entry.stages.finalized.slot} (+${entry.stages.finalized.delta_ms}ms)`);
    }
    if (entry.failure) {
      console.log(`      ❌ Failure: ${entry.failure.type}`);
      console.log(`      🤖 AI Diagnosis: ${entry.failure.agent_diagnosis}`);
    }
  });

  console.log("\n" + "=".repeat(60));
  console.log(`✅ Lifecycle log saved to: logs/lifecycle.json`);
  console.log(`📁 Submit this file with your bounty entry`);
  console.log("=".repeat(60));
}

async function main(): Promise<void> {
  console.log("\n" + "🚀".repeat(30));
  console.log("  TxPilot — Solana Smart Transaction Autopilot");
  console.log("  Built for SolInfra Advanced Infrastructure Challenge");
  console.log("🚀".repeat(30));

  console.log("\n[Main] Wallet:", CONFIG.walletKeypair.publicKey.toString());
  console.log("[Main] RPC:", CONFIG.solanaRpcUrl);
  console.log("[Main] Jito:", CONFIG.jitoBlockEngineUrl);

  // Step 1: Initialize stream
  console.log("\n[Main] 🌊 Initializing Yellowstone stream...");
  await initializeStream();

  // Step 2: Wait for first slot
  console.log("\n[Main] ⏳ Waiting for slot data...");
  const slot = await waitForSlot();
  console.log(`[Main] ✅ Current slot: ${slot}`);

  // Step 3: Check stream state
  const state = getStreamState();
  console.log(`[Main] 📊 Stream state:`);
  console.log(`  Connected: ${state.isConnected}`);
  console.log(`  Current slot: ${state.currentSlot}`);
  console.log(`  Recent tips: ${state.recentTips.length} samples`);
  console.log(`  Block utilization: ${state.blockUtilization}%`);

  // Step 4: Run normal bundles
  await runNormalBundles();

  // Step 5: Run failure scenarios
  await runFailureScenarios();

  // Step 6: Print summary
  await printFinalSummary();

  console.log("\n[Main] 🏁 TxPilot run complete!");
  process.exit(0);
}

main().catch((error) => {
  console.error("\n[Main] 💥 Fatal error:", error);
  process.exit(1);
});