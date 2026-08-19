/**
 * @quilt/evolve
 * ============================================================================
 * Self-improvement loops for Quilt.
 *
 * 4 components, 1 loop:
 *
 *   1. Generator  — LLM creates adversarial inputs
 *   2. System     — your Quilt sheet (or any function)
 *   3. Judge      — LLM scores (input, output) pairs
 *   4. Mutator    — applies feedback to the system
 *
 * Scopes determine what can be evolved:
 *   - FullSheetScope    — the whole organism
 *   - CellScope         — a single cell
 *   - SubGraphScope     — a group of cells (an "organ")
 *   - ProgramCodeScope  — the code of a program cell
 *   - HierarchicalScope — nested scopes
 *
 * Usage:
 *
 *   import { evolve, LLMGenerator, LLMJudge, LLMMutator, CellScope } from '@quilt/evolve';
 *   import { AIEngine } from '@quilt/ai';
 *
 *   const ai = new AIEngine({ zaiKey: process.env.ZAI_TOKEN });
 *   const system = new FunctionSystem({ name: 'summarizer', fn: myFn });
 *
 *   const result = await evolve({
 *     system,
 *     generator: new LLMGenerator({ ai, task: 'Summarize text' }),
 *     judge: new LLMJudge({ ai, task: 'Summarize text', criteria: ['accuracy', 'conciseness'] }),
 *     mutator: new LLMMutator({ ai, task: 'Summarize text', capabilities: ['prompt'] }),
 *     scope: new CellScope({ cellId: 'summary', capabilities: ['prompt'] }),
 *     iterations: 10,
 *     populationSize: 5,
 *   });
 *
 *   console.log(result.scoreProgression);  // [0.4, 0.5, 0.6, ...]
 *   console.log(result.improved);          // true
 *
 * This is RLAIF (RL from AI Feedback) applied to reactive sheets.
 * Hierarchical scopes let you evolve any level — cell, organ, or organism.
 *
 * ============================================================================
 */

export * from "./types.js";
export { evolve, summarize } from "./loop.js";
export { FunctionSystem, QuiltSystem } from "./system.js";
export {
  LLMGenerator,
  SeededGenerator,
  PerturbationGenerator,
  type AIEngineLike,
  type LLMGeneratorOptions,
} from "./generator.js";
export {
  LLMJudge,
  HeuristicJudge,
  ExactMatchJudge,
  type LLMJudgeOptions,
} from "./judge.js";
export {
  LLMMutator,
  NoOpMutator,
  FixedMutator,
  type LLMMutatorOptions,
} from "./mutate.js";
export {
  FullSheetScope,
  CellScope,
  SubGraphScope,
  ProgramCodeScope,
  HierarchicalScope,
} from "./scope.js";
