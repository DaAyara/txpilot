import * as fs from "fs";
import * as path from "path";

export type CommitmentStage = {
  slot: number;
  timestamp: string;
  delta_ms: number;
};

export type FailureInfo = {
  type:
    | "blockhash_expired"
    | "fee_too_low"
    | "compute_exceeded"
    | "bundle_dropped"
    | "leader_skip"
    | "unknown";
  details: string;
  agent_diagnosis: string;
  agent_retry_decision: string;
};

export type BundleLifecycleEntry = {
  bundle_id: string;
  attempt: number;
  submitted_at: string;
  submitted_slot: number;
  tip_lamports: number;
  tip_agent_reasoning: string;
  stages: {
    processed?: CommitmentStage;
    confirmed?: CommitmentStage;
    finalized?: CommitmentStage;
  };
  outcome: "success" | "failed" | "pending";
  failure?: FailureInfo;
  retry_of?: string;
};

class LifecycleLogger {
  private logDir: string;
  private logFile: string;
  private entries: BundleLifecycleEntry[] = [];

  constructor() {
    this.logDir = path.join(process.cwd(), "logs");
    this.logFile = path.join(this.logDir, "lifecycle.json");

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    if (fs.existsSync(this.logFile)) {
      try {
        this.entries = JSON.parse(fs.readFileSync(this.logFile, "utf-8"));
      } catch {
        this.entries = [];
      }
    }
  }

  createEntry(
    bundleId: string,
    attempt: number,
    submittedSlot: number,
    tipLamports: number,
    tipReasoning: string,
    retryOf?: string
  ): BundleLifecycleEntry {
    const entry: BundleLifecycleEntry = {
      bundle_id: bundleId,
      attempt,
      submitted_at: new Date().toISOString(),
      submitted_slot: submittedSlot,
      tip_lamports: tipLamports,
      tip_agent_reasoning: tipReasoning,
      stages: {},
      outcome: "pending",
      retry_of: retryOf,
    };

    this.entries.push(entry);
    this.save();
    this.printEntry("SUBMITTED", entry);
    return entry;
  }

  updateStage(
    bundleId: string,
    stage: "processed" | "confirmed" | "finalized",
    slot: number,
    submittedAt: string
  ) {
    const entry = this.entries.find((e) => e.bundle_id === bundleId);
    if (!entry) return;

    const now = new Date();
    const delta_ms = now.getTime() - new Date(submittedAt).getTime();

    entry.stages[stage] = {
      slot,
      timestamp: now.toISOString(),
      delta_ms,
    };

    if (stage === "finalized") {
      entry.outcome = "success";
    }

    this.save();
    console.log(
      `[LifecycleLogger] ✅ ${stage.toUpperCase()} | Bundle: ${bundleId.slice(0, 8)}... | Slot: ${slot} | Delta: ${delta_ms}ms`
    );
  }

  markFailed(bundleId: string, failure: FailureInfo) {
    const entry = this.entries.find((e) => e.bundle_id === bundleId);
    if (!entry) return;

    entry.outcome = "failed";
    entry.failure = failure;
    this.save();

    console.log(`[LifecycleLogger] ❌ FAILED | Bundle: ${bundleId.slice(0, 8)}...`);
    console.log(`  Type: ${failure.type}`);
    console.log(`  Details: ${failure.details}`);
    console.log(`  AI Diagnosis: ${failure.agent_diagnosis}`);
    console.log(`  AI Retry Decision: ${failure.agent_retry_decision}`);
  }

  private printEntry(event: string, entry: BundleLifecycleEntry) {
    console.log(`\n[LifecycleLogger] 📤 ${event}`);
    console.log(`  Bundle ID: ${entry.bundle_id.slice(0, 8)}...`);
    console.log(`  Attempt: ${entry.attempt}`);
    console.log(`  Slot: ${entry.submitted_slot}`);
    console.log(`  Tip: ${entry.tip_lamports} lamports`);
    console.log(`  AI Reasoning: ${entry.tip_agent_reasoning}`);
    if (entry.retry_of) {
      console.log(`  Retry of: ${entry.retry_of.slice(0, 8)}...`);
    }
  }

  getSummary() {
    const total = this.entries.length;
    const success = this.entries.filter((e) => e.outcome === "success").length;
    const failed = this.entries.filter((e) => e.outcome === "failed").length;
    const pending = this.entries.filter((e) => e.outcome === "pending").length;

    console.log(`\n[LifecycleLogger] 📊 SUMMARY`);
    console.log(`  Total bundles: ${total}`);
    console.log(`  Success: ${success}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Pending: ${pending}`);

    return { total, success, failed, pending };
  }

  getEntries() {
    return this.entries;
  }

  private save() {
    fs.writeFileSync(this.logFile, JSON.stringify(this.entries, null, 2));
  }
}

export const lifecycleLogger = new LifecycleLogger();