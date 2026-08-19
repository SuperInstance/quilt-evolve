/**
 * @quilt/evolve — generator
 * ============================================================================
 * The Generator creates adversarial inputs. It uses an LLM to:
 *   1. Look at the previous iteration's outputs and scores
 *   2. Reason about what kinds of inputs the system struggles with
 *   3. Generate new inputs that probe those weaknesses
 *
 * Without a previous iteration (iteration 0), it generates from scratch
 * using the system description as context.
 *
 * Usage:
 *   const gen = new LLMGenerator({
 *     ai: aiEngine,
 *     task: "Translate English to French",
 *     examples: [{ input: "Hello", output: "Bonjour" }],
 *   });
 *   const inputs = await gen.generate({ iteration: 0 });
 *
 * Falls back to seeded inputs if the LLM call fails.
 * ============================================================================
 */

import type { Generator, GeneratorContext, Datum } from "./types.js";

/** A minimal AI engine interface (compatible with @quilt/ai's AIEngine). */
export interface AIEngineLike {
  call(config: any, opts?: { useCache?: boolean; signal?: AbortSignal }): Promise<any>;
}

/** Options for LLMGenerator. */
export interface LLMGeneratorOptions {
  /** The AI engine to use. */
  ai: AIEngineLike;
  /** The provider (zai, kimi, deepseek, cloudflare). */
  provider?: string;
  /** The model to use. */
  model?: string;
  /** Description of the task the system performs. */
  task: string;
  /** Description of the input format (e.g., "Plain English text", "JSON object"). */
  inputFormat?: string;
  /** Description of the desired output. */
  outputDescription?: string;
  /** Few-shot examples of (input, output) pairs. */
  examples?: Array<{ input: Datum; output: Datum }>;
  /** How many inputs to generate per call. */
  count?: number;
  /** Temperature (default 0.9 for diverse inputs). */
  temperature?: number;
  /** Optional: focus areas the generator should emphasize. */
  focusAreas?: string[];
  /** Optional: seed inputs to use as inspiration. */
  seedInputs?: Datum[];
}

/** LLM-driven generator. */
export class LLMGenerator implements Generator {
  readonly name = "llm";
  readonly description: string;
  private opts: LLMGeneratorOptions;

  constructor(opts: LLMGeneratorOptions) {
    this.opts = {
      provider: "zai",
      model: "glm-4.5",
      inputFormat: "string",
      outputDescription: "the correct output",
      count: 5,
      temperature: 0.9,
      ...opts,
    };
    this.description = `LLM generator for: ${opts.task}`;
  }

  async generate(ctx: GeneratorContext): Promise<Datum[]> {
    // Build the prompt
    const prompt = this.buildPrompt(ctx);

    try {
      const result = await this.opts.ai.call({
        id: `gen-${ctx.iteration}`,
        kind: "ai.llm",
        provider: this.opts.provider,
        model: this.opts.model,
        prompt,
        temperature: this.opts.temperature,
        max_tokens: 2000,
      });

      // Parse the response — expect a JSON array
      const inputs = this.parseInputs(result);
      if (inputs.length > 0) return inputs;
    } catch (e) {
      // Fall through to seeded inputs
    }

    // Fallback: use seed inputs or random
    return this.fallback(ctx);
  }

  private buildPrompt(ctx: GeneratorContext): string {
    const { task, inputFormat, outputDescription, examples, count, focusAreas, seedInputs } = this.opts;
    const parts: string[] = [];

    parts.push(`You are an adversarial input generator. Your job is to create test inputs that will challenge a system performing the following task:`);
    parts.push("");
    parts.push(`TASK: ${task}`);
    parts.push(`INPUT FORMAT: ${inputFormat}`);
    parts.push(`EXPECTED OUTPUT: ${outputDescription}`);
    parts.push("");
    parts.push(`Generate exactly ${count} diverse, realistic, challenging inputs. Each input should be:`);
    parts.push(`- Realistic (could come from a real user)`);
    parts.push(`- Diverse (cover different scenarios, edge cases, lengths)`);
    parts.push(`- Challenging (likely to cause the system to make mistakes)`);
    parts.push(`- Distinct from each other (no near-duplicates)`);

    if (focusAreas && focusAreas.length > 0) {
      parts.push("");
      parts.push(`EMPHASIZE these areas: ${focusAreas.join(", ")}`);
    }

    if (examples && examples.length > 0) {
      parts.push("");
      parts.push(`EXAMPLES of the task:`);
      for (const ex of examples) {
        parts.push(`- Input: ${JSON.stringify(ex.input)}`);
        parts.push(`  Output: ${JSON.stringify(ex.output)}`);
      }
    }

    if (ctx.previousOutputs && ctx.previousOutputs.length > 0) {
      parts.push("");
      parts.push(`PREVIOUS ITERATION (iteration ${ctx.iteration - 1}):`);
      for (let i = 0; i < Math.min(ctx.previousOutputs.length, 3); i++) {
        const input = ctx.previousInputs?.[i];
        const output = ctx.previousOutputs[i];
        const score = ctx.previousScores?.[i];
        parts.push(`- Input: ${JSON.stringify(input)}`);
        parts.push(`  Output: ${JSON.stringify(output)}`);
        if (score) parts.push(`  Score: ${score.value.toFixed(2)} — ${score.reasoning || ""}`);
      }
      parts.push("");
      parts.push(`Generate new inputs that probe where the system is weak. Look at the low-scoring outputs above and create inputs that would trigger similar failures.`);
    } else if (seedInputs && seedInputs.length > 0) {
      parts.push("");
      parts.push(`SEED INPUTS (use as inspiration, generate DIFFERENT ones):`);
      for (const s of seedInputs) {
        parts.push(`- ${JSON.stringify(s)}`);
      }
    }

    parts.push("");
    parts.push(`RESPONSE FORMAT: respond with ONLY a JSON array of ${count} inputs. No explanation, no markdown fences, just the array. Example: ["input1", "input2", ...]`);
    if (inputFormat !== "string") {
      parts.push(`Each input should be a JSON object matching the input format.`);
    }

    return parts.join("\n");
  }

  private parseInputs(result: any): Datum[] {
    // Try to parse as JSON array
    if (Array.isArray(result)) return result;

    // Try to extract JSON from the result
    const text = String(result).trim();

    // Try direct JSON parse
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {}

    // Try to find array in the text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }

    // Try to split by newlines
    const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//") && !l.startsWith("#"));
    if (lines.length > 0) return lines;

    return [];
  }

  private fallback(ctx: GeneratorContext): Datum[] {
    if (this.opts.seedInputs && this.opts.seedInputs.length > 0) {
      return this.opts.seedInputs.slice(0, this.opts.count);
    }
    return ["fallback input 1", "fallback input 2", "fallback input 3"];
  }
}

/** A simple seeded generator (no LLM). Good for testing. */
export class SeededGenerator implements Generator {
  readonly name = "seeded";
  readonly description = "Returns inputs from a fixed pool in order";
  private inputs: Datum[];
  private cursor: number = 0;

  constructor(inputs: Datum[]) {
    this.inputs = inputs;
  }

  async generate(ctx: GeneratorContext): Promise<Datum[]> {
    const n = this.inputs.length;
    const out: Datum[] = [];
    for (let i = 0; i < n; i++) {
      out.push(this.inputs[(this.cursor + i) % n]);
    }
    this.cursor = (this.cursor + n) % this.inputs.length;
    return out;
  }
}

/** A random perturbation generator. Takes a base input and perturbs it. */
export class PerturbationGenerator implements Generator {
  readonly name = "perturbation";
  readonly description = "Perturbs a base input using LLM";
  private baseInputs: Datum[];
  private opts: LLMGeneratorOptions;

  constructor(baseInputs: Datum[], opts: LLMGeneratorOptions) {
    this.baseInputs = baseInputs;
    this.opts = opts;
  }

  async generate(ctx: GeneratorContext): Promise<Datum[]> {
    const perturbed = [];
    for (const base of this.baseInputs) {
      const result = await this.opts.ai.call({
        id: `perturb-${ctx.iteration}`,
        kind: "ai.llm",
        provider: this.opts.provider || "zai",
        model: this.opts.model || "glm-4.5",
        prompt: `Take this input and generate 3 challenging variations of it. Each variation should test a different edge case while keeping the core meaning.\n\nInput: ${JSON.stringify(base)}\n\nRespond with a JSON array of 3 variations.`,
        temperature: 0.8,
        max_tokens: 500,
      });
      try {
        const match = String(result).match(/\[[\s\S]*\]/);
        if (match) {
          const arr = JSON.parse(match[0]);
          if (Array.isArray(arr)) perturbed.push(...arr);
        }
      } catch {}
    }
    return perturbed.slice(0, this.opts.count || 5);
  }
}
