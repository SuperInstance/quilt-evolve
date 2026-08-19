/**
 * @quilt/evolve — judge
 * ============================================================================
 * The Judge scores (input, output) pairs. It uses an LLM to:
 *   1. Compare the output to the expected output (if known)
 *   2. Reason about quality
 *   3. Return a [0, 1] score + reasoning + structured feedback
 *
 * Usage:
 *   const judge = new LLMJudge({
 *     ai: aiEngine,
 *     task: "Translate to French",
 *     criteria: ["accuracy", "fluency", "conciseness"],
 *   });
 *   const score = await judge.judge({ input, output, expected });
 *
 * Also includes a heuristic judge (no LLM) for testing.
 * ============================================================================
 */

import type { Judge, JudgeContext, Score } from "./types.js";
import type { AIEngineLike } from "./generator.js";

/** Options for LLMJudge. */
export interface LLMJudgeOptions {
  /** The AI engine to use. */
  ai: AIEngineLike;
  /** The provider. */
  provider?: string;
  /** The model. */
  model?: string;
  /** Description of the task. */
  task: string;
  /** Description of the desired output quality. */
  qualityDescription?: string;
  /** Criteria to score on. E.g., ["accuracy", "fluency", "conciseness"]. */
  criteria?: string[];
  /** Weights for each criterion. Defaults to equal. */
  weights?: number[];
  /** Whether to require the LLM to return structured JSON. */
  structuredOutput?: boolean;
}

/** LLM-driven judge. */
export class LLMJudge implements Judge {
  readonly name = "llm";
  readonly description: string;
  private opts: LLMJudgeOptions;

  constructor(opts: LLMJudgeOptions) {
    this.opts = {
      provider: "zai",
      model: "glm-4.5",
      qualityDescription: "correct, clear, complete",
      criteria: ["accuracy"],
      structuredOutput: true,
      ...opts,
    };
    this.description = `LLM judge for: ${opts.task}`;
  }

  async judge(ctx: JudgeContext): Promise<Score> {
    const prompt = this.buildPrompt(ctx);

    try {
      const result = await this.opts.ai.call({
        id: `judge-${ctx.iteration || 0}`,
        kind: "ai.llm",
        provider: this.opts.provider,
        model: this.opts.model,
        prompt,
        temperature: 0.2,  // low temperature for consistent judging
        max_tokens: 500,
      });

      return this.parseScore(result);
    } catch (e: any) {
      return {
        value: 0.5,
        reasoning: `Judge failed: ${e.message}`,
        feedback: { error: e.message },
      };
    }
  }

  async judgeBatch(ctxs: JudgeContext[]): Promise<Score[]> {
    return Promise.all(ctxs.map(ctx => this.judge(ctx)));
  }

  private buildPrompt(ctx: JudgeContext): string {
    const { task, qualityDescription, criteria, structuredOutput } = this.opts;
    const parts: string[] = [];

    parts.push(`You are a strict, fair judge. Score the following output for the given task.`);
    parts.push("");
    parts.push(`TASK: ${task}`);
    parts.push(`QUALITY CRITERIA: ${qualityDescription}`);
    parts.push("");
    parts.push(`SCORING CRITERIA (each 0-1):`);
    for (const c of criteria!) {
      parts.push(`- ${c}`);
    }
    parts.push("");

    parts.push(`INPUT:`);
    parts.push(JSON.stringify(ctx.input));
    parts.push("");
    parts.push(`OUTPUT to judge:`);
    parts.push(JSON.stringify(ctx.output));

    if (ctx.expected !== undefined) {
      parts.push("");
      parts.push(`EXPECTED output:`);
      parts.push(JSON.stringify(ctx.expected));
    }

    parts.push("");
    if (structuredOutput) {
      parts.push(`RESPOND with ONLY a JSON object of this shape (no markdown, no explanation):`);
      parts.push(`{`);
      parts.push(`  "overall": <float 0-1, weighted average>,\n  "metrics": {${criteria!.map(c => `"${c}": <0-1>`).join(", ")}},\n  "reasoning": "<1-2 sentences>",\n  "feedback": "<actionable suggestion for improvement, or null>"`);
      parts.push(`}`);
    } else {
      parts.push(`On a scale of 0 to 1, how good is this output? Respond with just the number, then a 1-sentence reason.`);
    }

    return parts.join("\n");
  }

  private parseScore(result: any): Score {
    const text = String(result).trim();

    // Try direct JSON parse
    try {
      const obj = JSON.parse(text);
      if (typeof obj === "object" && obj !== null) {
        return {
          value: typeof obj.overall === "number" ? obj.overall : 0.5,
          reasoning: obj.reasoning || "",
          feedback: obj.feedback,
          metrics: obj.metrics,
        };
      }
    } catch {}

    // Try to find JSON in the text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        return {
          value: typeof obj.overall === "number" ? obj.overall : 0.5,
          reasoning: obj.reasoning || "",
          feedback: obj.feedback,
          metrics: obj.metrics,
        };
      } catch {}
    }

    // Try to extract a number
    const numMatch = text.match(/(\d+\.?\d*)/);
    if (numMatch) {
      let n = parseFloat(numMatch[1]);
      if (n > 1) n = n / 10;  // normalize if judge used 0-10
      return { value: n, reasoning: text.slice(0, 200) };
    }

    return { value: 0.5, reasoning: text.slice(0, 200) };
  }
}

/**
 * A heuristic judge (no LLM). Good for testing.
 * Scores based on simple rules: contains expected, length ratio, etc.
 */
export class HeuristicJudge implements Judge {
  readonly name = "heuristic";
  readonly description = "Simple rules-based judge, no LLM required";

  constructor(private opts: {
    /** Function to compute score. */
    fn: (input: any, output: any, expected?: any) => number;
    /** Optional function to provide reasoning. */
    reasoningFn?: (input: any, output: any, expected?: any) => string;
  }) {}

  async judge(ctx: JudgeContext): Promise<Score> {
    const v = this.opts.fn(ctx.input, ctx.output, ctx.expected);
    const r = this.opts.reasoningFn ? this.opts.reasoningFn(ctx.input, ctx.output, ctx.expected) : `Heuristic score: ${v}`;
    return { value: v, reasoning: r };
  }

  async judgeBatch(ctxs: JudgeContext[]): Promise<Score[]> {
    return Promise.all(ctxs.map(ctx => this.judge(ctx)));
  }
}

/**
 * A "ground truth" judge that compares output to expected.
 * Returns 1 if output === expected, 0 otherwise. For exact match tasks.
 */
export class ExactMatchJudge implements Judge {
  readonly name = "exact";
  readonly description = "1 if output === expected, 0 otherwise";
  async judge(ctx: JudgeContext): Promise<Score> {
    if (ctx.expected === undefined) {
      return { value: 0.5, reasoning: "no expected output to compare against" };
    }
    const match = JSON.stringify(ctx.output) === JSON.stringify(ctx.expected);
    return {
      value: match ? 1 : 0,
      reasoning: match ? "exact match" : `expected ${JSON.stringify(ctx.expected)}, got ${JSON.stringify(ctx.output)}`,
    };
  }
  async judgeBatch(ctxs: JudgeContext[]): Promise<Score[]> {
    return Promise.all(ctxs.map(ctx => this.judge(ctx)));
  }
}
