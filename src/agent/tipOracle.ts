import Groq from "groq-sdk";
import { CONFIG } from "../config/index";

const client = new Groq({ apiKey: CONFIG.groqApiKey });

export type TipDecision = {
  tip_lamports: number;
  confidence: "low" | "medium" | "high";
  percentile_used: number;
  reasoning: string;
};

export type NetworkConditions = {
  recentTips: number[];
  currentSlot: number;
  blockUtilization: number;
  isJitoLeaderNext: boolean;
};

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 100000;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function buildTipContext(conditions: NetworkConditions): string {
  const tips = conditions.recentTips;
  const p50 = calculatePercentile(tips, 50);
  const p75 = calculatePercentile(tips, 75);
  const p90 = calculatePercentile(tips, 90);
  const p95 = calculatePercentile(tips, 95);

  return `
You are a Solana Jito bundle tip oracle. Decide the optimal tip amount in lamports.

CURRENT NETWORK CONDITIONS:
- Current slot: ${conditions.currentSlot}
- Block utilization: ${conditions.blockUtilization}%
- Next leader is Jito validator: ${conditions.isJitoLeaderNext}
- Recent tip samples (${tips.length} bundles): ${tips.join(", ")} lamports

TIP STATISTICS:
- p50: ${p50} lamports
- p75: ${p75} lamports
- p90: ${p90} lamports
- p95: ${p95} lamports

RULES:
- Higher block utilization = higher tip needed
- p50 tip = ~50% landing chance, p75 = ~75%, p90 = ~90%
- Minimum tip: 10000 lamports
- Maximum tip: 1000000 lamports

Respond ONLY with valid JSON, no markdown, no explanation outside JSON:
{
  "tip_lamports": <number>,
  "confidence": "<low|medium|high>",
  "percentile_used": <number>,
  "reasoning": "<your reasoning in one paragraph>"
}`;
}

export async function decideTip(
  conditions: NetworkConditions
): Promise<TipDecision> {
  console.log("\n[TipOracle] 🤖 AI agent analyzing network conditions...");
  console.log(`  Current slot: ${conditions.currentSlot}`);
  console.log(`  Block utilization: ${conditions.blockUtilization}%`);
  console.log(`  Recent tips count: ${conditions.recentTips.length}`);
  console.log(`  Next leader is Jito: ${conditions.isJitoLeaderNext}`);

  if (!CONFIG.groqApiKey) {
    console.log("[TipOracle] ⚠️ No Groq key, using fallback logic");
    return fallbackTipDecision(conditions);
  }

  try {
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: buildTipContext(conditions),
        },
      ],
    });

    const text = response.choices[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const decision: TipDecision = JSON.parse(clean);

    console.log(`\n[TipOracle] 🎯 AI Decision:`);
    console.log(`  Tip: ${decision.tip_lamports} lamports`);
    console.log(`  Confidence: ${decision.confidence}`);
    console.log(`  Percentile: p${decision.percentile_used}`);
    console.log(`  Reasoning: ${decision.reasoning}`);

    return decision;
  } catch (error) {
    console.log(`[TipOracle] ⚠️ AI call failed, using fallback: ${error}`);
    return fallbackTipDecision(conditions);
  }
}

function fallbackTipDecision(conditions: NetworkConditions): TipDecision {
  const tips = conditions.recentTips;
  const p75 = calculatePercentile(tips.length > 0 ? tips : [100000], 75);

  return {
    tip_lamports: p75,
    confidence: "medium",
    percentile_used: 75,
    reasoning: `Fallback decision: using p75 tip of ${p75} lamports based on ${tips.length} recent samples. Block utilization at ${conditions.blockUtilization}%.`,
  };
}