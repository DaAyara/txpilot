import Groq from "groq-sdk";
import { CONFIG } from "../config/index";
import { FailureInfo } from "../logger/lifecycleLogger";

const client = new Groq({ apiKey: CONFIG.groqApiKey });

export type FailureContext = {
  bundleId: string;
  attempt: number;
  failureType: string;
  tipPaid: number;
  blockhashAge: number;
  currentSlot: number;
  submittedSlot: number;
  recentP75Tip: number;
  jitoLeaderSkipped: boolean;
};

export type RetryDecision = {
  should_retry: boolean;
  refresh_blockhash: boolean;
  new_tip_multiplier: number;
  wait_slots: number;
  diagnosis: string;
  retry_reasoning: string;
  failure_type:
    | "blockhash_expired"
    | "fee_too_low"
    | "compute_exceeded"
    | "bundle_dropped"
    | "leader_skip"
    | "unknown";
};

function buildFailureContext(ctx: FailureContext): string {
  return `
You are a Solana transaction failure analyst. Diagnose this failed Jito bundle and decide the retry strategy.

FAILED BUNDLE DETAILS:
- Bundle ID: ${ctx.bundleId}
- Attempt number: ${ctx.attempt}
- Submitted at slot: ${ctx.submittedSlot}
- Current slot: ${ctx.currentSlot}
- Blockhash age at submission: ${ctx.blockhashAge} slots
- Tip paid: ${ctx.tipPaid} lamports
- Recent p75 tip (market rate): ${ctx.recentP75Tip} lamports
- Jito leader skipped their slot: ${ctx.jitoLeaderSkipped}
- Raw failure type reported: ${ctx.failureType}

SOLANA RULES:
- Blockhash expires after 150 slots. Age > 140 = likely cause
- If tip < p75 market rate, bundle was likely outbid
- If Jito leader skipped, bundle is silently dropped
- After 3 failed attempts, recommend stopping
- Blockhash refresh REQUIRED if age > 140 slots

FAILURE TYPES: blockhash_expired, fee_too_low, leader_skip, bundle_dropped, compute_exceeded, unknown

Respond ONLY with valid JSON, no markdown:
{
  "should_retry": <true|false>,
  "refresh_blockhash": <true|false>,
  "new_tip_multiplier": <number like 1.0, 1.5, 2.0>,
  "wait_slots": <number>,
  "diagnosis": "<what went wrong>",
  "retry_reasoning": "<why this retry decision>",
  "failure_type": "<one of the failure types>"
}`;
}

export async function analyzeFailure(
  ctx: FailureContext
): Promise<RetryDecision> {
  console.log("\n[FailureAnalyst] 🤖 AI agent diagnosing failure...");
  console.log(`  Bundle: ${ctx.bundleId.slice(0, 8)}...`);
  console.log(`  Attempt: ${ctx.attempt}`);
  console.log(`  Blockhash age: ${ctx.blockhashAge} slots`);
  console.log(`  Tip paid: ${ctx.tipPaid} lamports`);
  console.log(`  Market p75: ${ctx.recentP75Tip} lamports`);
  console.log(`  Leader skipped: ${ctx.jitoLeaderSkipped}`);

  if (!CONFIG.groqApiKey) {
    console.log("[FailureAnalyst] ⚠️ No Groq key, using fallback logic");
    return fallbackAnalysis(ctx);
  }

  try {
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: buildFailureContext(ctx),
        },
      ],
    });

    const text = response.choices[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const decision: RetryDecision = JSON.parse(clean);

    console.log(`\n[FailureAnalyst] 🔍 AI Diagnosis:`);
    console.log(`  Failure type: ${decision.failure_type}`);
    console.log(`  Should retry: ${decision.should_retry}`);
    console.log(`  Refresh blockhash: ${decision.refresh_blockhash}`);
    console.log(`  New tip multiplier: ${decision.new_tip_multiplier}x`);
    console.log(`  Wait slots: ${decision.wait_slots}`);
    console.log(`  Diagnosis: ${decision.diagnosis}`);
    console.log(`  Retry reasoning: ${decision.retry_reasoning}`);

    return decision;
  } catch (error) {
    console.log(`[FailureAnalyst] ⚠️ AI call failed, using fallback: ${error}`);
    return fallbackAnalysis(ctx);
  }
}

function fallbackAnalysis(ctx: FailureContext): RetryDecision {
  if (ctx.blockhashAge > 140) {
    return {
      should_retry: ctx.attempt < 3,
      refresh_blockhash: true,
      new_tip_multiplier: 1.0,
      wait_slots: 2,
      diagnosis: `Blockhash expired. It was ${ctx.blockhashAge} slots old, exceeding the 150-slot validity window.`,
      retry_reasoning: `Refreshing blockhash and resubmitting with same tip since expiry was the only issue.`,
      failure_type: "blockhash_expired",
    };
  }

  if (ctx.tipPaid < ctx.recentP75Tip) {
    return {
      should_retry: ctx.attempt < 3,
      refresh_blockhash: false,
      new_tip_multiplier: 1.5,
      wait_slots: 1,
      diagnosis: `Tip too low. Paid ${ctx.tipPaid} lamports but market p75 is ${ctx.recentP75Tip} lamports.`,
      retry_reasoning: `Increasing tip by 1.5x to beat market rate.`,
      failure_type: "fee_too_low",
    };
  }

  if (ctx.jitoLeaderSkipped) {
    return {
      should_retry: ctx.attempt < 3,
      refresh_blockhash: true,
      new_tip_multiplier: 1.0,
      wait_slots: 4,
      diagnosis: `Jito leader skipped their slot. Bundle was silently dropped.`,
      retry_reasoning: `Waiting 4 slots for next Jito leader window and resubmitting.`,
      failure_type: "leader_skip",
    };
  }

  return {
    should_retry: ctx.attempt < 3,
    refresh_blockhash: true,
    new_tip_multiplier: 1.5,
    wait_slots: 2,
    diagnosis: `Unknown failure. Raw type: ${ctx.failureType}`,
    retry_reasoning: `Refreshing blockhash and increasing tip as precaution.`,
    failure_type: "unknown",
  };
}

export function buildFailureInfo(
  decision: RetryDecision,
  details: string
): FailureInfo {
  return {
    type: decision.failure_type,
    details,
    agent_diagnosis: decision.diagnosis,
    agent_retry_decision: decision.retry_reasoning,
  };
}