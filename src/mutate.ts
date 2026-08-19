/**
 * @quilt/evolve — mutator
 * ============================================================================
 * The Mutator applies feedback to the system. It uses an LLM to:
 *   1. Look at the scores and feedback from this iteration
 *   2. Reason about what should change
 *   3. Generate specific mutations
 *
 * Different scopes enable different mutation types:
 *   - PromptScope:  changes LLM prompts
 *   - FormulaScope: changes formula expressions
 *   - ParameterScope: changes parameters (temperature, max_tokens, etc.)
 *   - FullSheetScope: can add/remove/connect cells
 *
 * Usage:
 *   const mutator = new LLMMutator({ ai, task, scope });
 *   const result = await mutator.mutate({ system, scores, ... });
 *
 * Includes a no-op mutator (does nothing) and an identity mutator.
 * ============================================================================
 */

import type { Mutator, MutatorContext, MutationResult, Mutation } from "./types.js";
import type { AIEngineLike } from "./generator.js";

/** Options for LLMMutator. */
export interface LLMMutatorOptions {
  /** The AI engine. */
  ai: AIEngineLike;
  /** The provider. */
  provider?: string;
  /** The model. */
  model?: string;
  /** The task description. */
  task: string;
  /** What can be mutated. */
  capabilities: string[];
  /** Optional: only mutate if score is below this threshold. */
  threshold?: number;
  /** Optional: max mutations per iteration. */
  maxMutations?: number;
}

/** LLM-driven mutator. */
export class LLMMutator implements Mutator {
  readonly name = "llm";
  readonly description: string;
  private opts: LLMMutatorOptions;

  constructor(opts: LLMMutatorOptions) {
    this.opts = {
      provider: "zai",
      model: "glm-4.5",
      threshold: 0.95,
      maxMutations: 1,
      ...opts,
    };
    this.description = `LLM mutator for: ${opts.task}`;
  }

  async mutate(ctx: MutatorContext): Promise<MutationResult> {
    const avgScore = ctx.scores.reduce((s, x) => s + x.value, 0) / ctx.scores.length;

    // If we're already doing well, don't mutate
    if (avgScore >= this.opts.threshold!) {
      return { system: ctx.system, mutations: [], notes: "score above threshold, no mutation" };
    }

    const prompt = this.buildPrompt(ctx);
    try {
      const result = await this.opts.ai.call({
        id: `mutate-${ctx.iteration}`,
        kind: "ai.llm",
        provider: this.opts.provider,
        model: this.opts.model,
        prompt,
        temperature: 0.5,
        max_tokens: 1500,
      });

      const mutations = this.parseMutations(result);
      const mutated = this.applyMutations(ctx.system, mutations);

      return {
        system: mutated,
        mutations,
        notes: `Average score ${avgScore.toFixed(2)} — applied ${mutations.length} mutation(s)`,
      };
    } catch (e: any) {
      return {
        system: ctx.system,
        mutations: [],
        notes: `Mutator failed: ${e.message}`,
      };
    }
  }

  private buildPrompt(ctx: MutatorContext): string {
    const { task, capabilities, maxMutations } = this.opts;
    const parts: string[] = [];

    parts.push(`You are a system mutator. Based on the feedback below, generate specific changes to improve the system.`);
    parts.push("");
    parts.push(`TASK: ${task}`);
    parts.push("");
    parts.push(`CAPABILITIES (what you can change):`);
    for (const c of capabilities) {
      parts.push(`- ${c}`);
    }
    parts.push("");
    parts.push(`CURRENT SYSTEM (YAML or JSON):`);
    parts.push(JSON.stringify(ctx.system, null, 2).slice(0, 3000));
    parts.push("");
    parts.push(`THIS ITERATION:`);
    parts.push(`Average score: ${(ctx.scores.reduce((s, x) => s + x.value, 0) / ctx.scores.length).toFixed(2)}`);
    parts.push("");
    parts.push(`Examples (showing what's failing):`);
    for (let i = 0; i < Math.min(ctx.scores.length, 3); i++) {
      const s = ctx.scores[i];
      const input = ctx.inputs[i];
      const output = ctx.outputs[i];
      parts.push(`- Input: ${JSON.stringify(input)}`);
      parts.push(`  Output: ${JSON.stringify(output)}`);
      parts.push(`  Score: ${s.value.toFixed(2)} — ${s.reasoning || ""}`);
      if (s.feedback) parts.push(`  Feedback: ${JSON.stringify(s.feedback)}`);
    }
    parts.push("");
    parts.push(`Generate up to ${maxMutations} specific mutation(s) that will improve the score. Each mutation should be:`);
    parts.push(`- Small (one change at a time)`);
    parts.push(`- Specific (give exact before/after values)`);
    parts.push(`- Likely to improve (think about why it would help)`);
    parts.push("");
    parts.push(`RESPOND with ONLY a JSON object (no markdown, no explanation):`);
    parts.push(`{`);
    parts.push(`  "mutations": [`);
    parts.push(`    {`);
    parts.push(`      "description": "<what this changes>",`);
    parts.push(`      "path": "<dot.path.to.field>",`);
    parts.push(`      "before": <current value>,`);
    parts.push(`      "after": <new value>,`);
    parts.push(`      "expectedImprovement": <0-1, your estimate>`);
    parts.push(`    }`);
    parts.push(`  ]`);
    parts.push(`}`);

    return parts.join("\n");
  }

  private parseMutations(result: any): Mutation[] {
    const text = String(result).trim();
    try {
      const obj = JSON.parse(text);
      if (Array.isArray(obj.mutations)) {
        return obj.mutations.filter((m: any) =>
          m && typeof m === "object" && m.description && m.after !== undefined
        );
      }
    } catch {}
    // Try to find JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (Array.isArray(obj.mutations)) {
          return obj.mutations.filter((m: any) =>
            m && typeof m === "object" && m.description && m.after !== undefined
          );
        }
      } catch {}
    }
    return [];
  }

  private applyMutations(system: any, mutations: Mutation[]): any {
    if (!Array.isArray(system) || mutations.length === 0) return system;

    // Deep clone
    const newSystem = JSON.parse(JSON.stringify(system));

    for (const m of mutations) {
      if (!m.path) continue;
      const parts = m.path.split(".");
      let obj: any = newSystem;
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] === undefined) break;
        obj = obj[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (obj && typeof obj === "object" && last in obj) {
        obj[last] = m.after;
      }
    }

    return newSystem;
  }
}

/** A no-op mutator (does nothing). */
export class NoOpMutator implements Mutator {
  readonly name = "noop";
  readonly description = "Does not mutate. Useful for measuring the baseline.";
  async mutate(ctx: MutatorContext): Promise<MutationResult> {
    return { system: ctx.system, mutations: [], notes: "no-op mutator" };
  }
}

/** A simple mutator that always applies a fixed change. */
export class FixedMutator implements Mutator {
  readonly name = "fixed";
  readonly description = "Always applies the same mutation. For testing.";
  constructor(private mutation: Mutation) {}
  async mutate(ctx: MutatorContext): Promise<MutationResult> {
    return {
      system: ctx.system,
      mutations: [this.mutation],
      notes: "fixed mutation",
    };
  }
}
