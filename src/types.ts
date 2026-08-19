/**
 * @quilt/evolve — types
 * ============================================================================
 * The type system for self-improvement loops.
 *
 * A Loop has 5 components:
 *
 *   1. Generator  — LLM-driven adversarial input creator
 *   2. System     — the Quilt sheet (or any function) being evolved
 *   3. Judge      — LLM-driven scorer of (input, output) pairs
 *   4. Mutator    — applies feedback to the system
 *   5. Scope      — which part of the system to evolve (cell, organ, organism)
 *
 * The loop runs N iterations:
 *
 *   for i in 0..N:
 *     inputs = generator.generate(previous_outputs)
 *     outputs = system.run(inputs)           // for each input
 *     scores = judge.judge(inputs, outputs)
 *     system = mutator.mutate(system, scores)
 *
 * ============================================================================
 */

/** A single piece of data flowing through the loop. */
export type Datum = unknown;

/** A score from the judge. Higher is better. Range [0, 1] by default. */
export interface Score {
  /** Numerical score, [0, 1]. */
  value: number;
  /** Reasoning from the judge. */
  reasoning?: string;
  /** Optional structured feedback for the mutator. */
  feedback?: Datum;
  /** Individual metric breakdown. */
  metrics?: Record<string, number>;
}

/** Context passed to the generator. */
export interface GeneratorContext {
  /** Current iteration (0-indexed). */
  iteration: number;
  /** Previous iteration's inputs. */
  previousInputs?: Datum[];
  /** Previous iteration's outputs. */
  previousOutputs?: Datum[];
  /** Previous iteration's scores. */
  previousScores?: Score[];
  /** The current system (read-only). */
  system?: Datum;
}

/** Context passed to the judge. */
export interface JudgeContext {
  /** The input that was passed to the system. */
  input: Datum;
  /** The output the system produced. */
  output: Datum;
  /** The expected output, if known. */
  expected?: Datum;
  /** The current system (read-only). */
  system?: Datum;
  /** The current iteration. */
  iteration?: number;
}

/** Context passed to the mutator. */
export interface MutatorContext {
  /** The system to mutate. */
  system: Datum;
  /** Scores from this iteration. */
  scores: Score[];
  /** Inputs from this iteration. */
  inputs: Datum[];
  /** Outputs from this iteration. */
  outputs: Datum[];
  /** The current iteration. */
  iteration: number;
  /** The best score so far. */
  bestScore?: number;
}

/** A mutation that was applied. */
export interface Mutation {
  /** Description of what changed. */
  description: string;
  /** Path that changed (e.g., "cells.ai.llm.prompt"). */
  path?: string;
  /** Before value. */
  before?: Datum;
  /** After value. */
  after?: Datum;
  /** Expected improvement (judge's prediction). */
  expectedImprovement?: number;
}

/** Result of a mutation. */
export interface MutationResult {
  /** The new (mutated) system. */
  system: Datum;
  /** The mutations that were applied. */
  mutations: Mutation[];
  /** Notes about the mutation. */
  notes?: string;
}

/** The scope of evolution. */
export interface Scope {
  /** Human-readable name. */
  name: string;
  /** What this scope can mutate. */
  capabilities: MutationCapability[];
  /** Extract the part of the system to evolve. */
  extract(system: Datum): Datum;
  /** Apply a mutated sub-system back into the whole. */
  apply(system: Datum, mutated: Datum): Datum;
  /** A path identifier (e.g., "cell:ai.llm", "graph:router", "sheet:default"). */
  path(): string;
}

/** What a scope can mutate. */
export type MutationCapability =
  | 'formula'      // change a formula expression
  | 'prompt'       // change an LLM prompt
  | 'parameter'    // change a parameter (e.g., temperature, max_tokens)
  | 'structure'    // add/remove/connect cells
  | 'value'        // change a static value
  | 'code';        // change program code

/** A generator creates adversarial inputs. */
export interface Generator {
  /** Name. */
  name: string;
  /** Description. */
  description?: string;
  /** Generate the next batch of inputs. */
  generate(ctx: GeneratorContext): Promise<Datum[]>;
}

/** A system processes inputs into outputs. */
export interface System {
  /** Name. */
  name: string;
  /** Description. */
  description?: string;
  /** Run the system on a single input. */
  run(input: Datum): Promise<Datum>;
  /** Get a snapshot of the current system (for mutation). */
  snapshot(): Datum;
  /** Apply a snapshot back to the system. */
  restore(snapshot: Datum): void;
}

/** A judge scores (input, output) pairs. */
export interface Judge {
  /** Name. */
  name: string;
  /** Description. */
  description?: string;
  /** Judge a single (input, output) pair. */
  judge(ctx: JudgeContext): Promise<Score>;
  /** Judge a batch. Default impl calls judge() in parallel. */
  judgeBatch(ctxs: JudgeContext[]): Promise<Score[]>;
}

/** A mutator applies feedback to the system. */
export interface Mutator {
  /** Name. */
  name: string;
  /** Description. */
  description?: string;
  /** Mutate the system based on feedback. */
  mutate(ctx: MutatorContext): Promise<MutationResult>;
}

/** Result of one iteration. */
export interface IterationResult {
  /** Iteration number. */
  iteration: number;
  /** Inputs that were generated. */
  inputs: Datum[];
  /** Outputs that the system produced. */
  outputs: Datum[];
  /** Scores from the judge. */
  scores: Score[];
  /** Mutations that were applied (after the iteration). */
  mutations: Mutation[];
  /** Average score. */
  averageScore: number;
  /** Best score in this iteration. */
  bestScore: number;
  /** Worst score in this iteration. */
  worstScore: number;
  /** Standard deviation. */
  stdDev: number;
  /** Wall time in ms. */
  wallTimeMs: number;
  /** The system snapshot at the start of this iteration. */
  systemBefore: Datum;
  /** The system snapshot at the end of this iteration. */
  systemAfter: Datum;
}

/** Final result of a loop run. */
export interface LoopResult {
  /** The scope that was evolved. */
  scope: Scope;
  /** All iterations. */
  iterations: IterationResult[];
  /** The best iteration (by average score). */
  best: IterationResult;
  /** The final system. */
  finalSystem: Datum;
  /** Score progression (one number per iteration). */
  scoreProgression: number[];
  /** Whether the loop improved (last > first). */
  improved: boolean;
  /** Total wall time. */
  totalWallTimeMs: number;
}

/** Configuration for a loop. */
export interface LoopConfig {
  /** The system to evolve. */
  system: System;
  /** The generator. */
  generator: Generator;
  /** The judge. */
  judge: Judge;
  /** The mutator (optional — without it, the system doesn't change). */
  mutator?: Mutator;
  /** The scope. */
  scope: Scope;
  /** Number of iterations. */
  iterations: number;
  /** Inputs per iteration. */
  populationSize: number;
  /** Optional seed inputs to start with. */
  seedInputs?: Datum[];
  /** Optional: early stop if score plateaus. */
  plateauThreshold?: number;
  /** Optional: log to console. */
  verbose?: boolean;
  /** Optional: callback for each iteration. */
  onIteration?: (result: IterationResult) => void | Promise<void>;
}
