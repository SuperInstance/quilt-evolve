/**
 * @quilt/evolve — loop
 * ============================================================================
 * The main improvement loop. Runs N iterations of:
 *
 *   1. Generate adversarial inputs (informed by previous iteration)
 *   2. Run the system on each input
 *   3. Judge each (input, output) pair
 *   4. Apply mutations based on feedback
 *
 * Returns the score progression and the final system.
 *
 * Usage:
 *   const result = await evolve({
 *     system, generator, judge, mutator, scope,
 *     iterations: 10,
 *     populationSize: 5,
 *   });
 *
 *   console.log(result.scoreProgression);  // [0.4, 0.5, 0.6, ...]
 *   console.log(result.improved);          // true
 *   console.log(result.best);              // the best iteration
 *
 * ============================================================================
 */

import type {
  LoopConfig,
  LoopResult,
  IterationResult,
  Score,
} from "./types.js";

/**
 * Run the evolution loop.
 */
export async function evolve(config: LoopConfig): Promise<LoopResult> {
  const {
    system,
    generator,
    judge,
    mutator,
    scope,
    iterations,
    populationSize,
    seedInputs,
    plateauThreshold,
    verbose,
    onIteration,
  } = config;

  const startTime = Date.now();
  const iterResults: IterationResult[] = [];
  let currentSystem = system;
  let lastInputs = seedInputs;
  let bestScore = 0;
  let plateauCount = 0;

  for (let i = 0; i < iterations; i++) {
    const iterStart = Date.now();

    // 1. Generate inputs
    const genCtx = {
      iteration: i,
      previousInputs: lastInputs,
      previousOutputs: iterResults.at(-1)?.outputs,
      previousScores: iterResults.at(-1)?.scores,
      system: currentSystem.snapshot ? currentSystem.snapshot() : undefined,
    };
    const inputs = await generator.generate(genCtx);
    const effectiveInputs = inputs.length > 0 ? inputs.slice(0, populationSize) : (seedInputs || []).slice(0, populationSize);

    // 2. Run system
    const outputs: any[] = [];
    for (const input of effectiveInputs) {
      try {
        const out = await currentSystem.run(input);
        outputs.push(out);
      } catch (e: any) {
        outputs.push({ error: e.message });
      }
    }

    // 3. Judge
    const judgeCtxs = effectiveInputs.map((input, j) => ({
      input,
      output: outputs[j],
      system: currentSystem.snapshot ? currentSystem.snapshot() : undefined,
      iteration: i,
    }));
    const scores = await judge.judgeBatch(judgeCtxs);

    // 4. Compute stats
    const scoreValues = scores.map(s => s.value);
    const avg = scoreValues.reduce((s, x) => s + x, 0) / scoreValues.length;
    const best = Math.max(...scoreValues);
    const worst = Math.min(...scoreValues);
    const mean = avg;
    const variance = scoreValues.reduce((s, x) => s + (x - mean) ** 2, 0) / scoreValues.length;
    const stdDev = Math.sqrt(variance);

    const systemBefore = currentSystem.snapshot ? currentSystem.snapshot() : null;

    // 5. Mutate (unless last iteration)
    let mutations: any[] = [];
    if (mutator && i < iterations - 1) {
      const mutCtx = {
        system: systemBefore,
        scores,
        inputs: effectiveInputs,
        outputs,
        iteration: i,
        bestScore,
      };
      const mutResult = await mutator.mutate(mutCtx);
      mutations = mutResult.mutations;
      // Apply the new system
      if (mutResult.system) {
        currentSystem.restore(mutResult.system);
      }
    }

    const systemAfter = currentSystem.snapshot ? currentSystem.snapshot() : systemBefore;

    const iterResult: IterationResult = {
      iteration: i,
      inputs: effectiveInputs,
      outputs,
      scores,
      mutations,
      averageScore: avg,
      bestScore: best,
      worstScore: worst,
      stdDev,
      wallTimeMs: Date.now() - iterStart,
      systemBefore,
      systemAfter,
    };
    iterResults.push(iterResult);

    if (onIteration) await onIteration(iterResult);

    if (verbose) {
      console.log(`[iter ${i}] avg=${avg.toFixed(3)} best=${best.toFixed(3)} worst=${worst.toFixed(3)} stddev=${stdDev.toFixed(3)} mutations=${mutations.length} time=${iterResult.wallTimeMs}ms`);
    }

    // Plateau detection
    if (best > bestScore) {
      bestScore = best;
      plateauCount = 0;
    } else if (plateauThreshold !== undefined) {
      plateauCount++;
      if (plateauCount >= plateauThreshold) {
        if (verbose) console.log(`Plateau detected (${plateauCount} iterations), stopping early.`);
        break;
      }
    }

    lastInputs = effectiveInputs;
  }

  // Find the best iteration
  let best = iterResults[0];
  for (const r of iterResults) {
    if (r.averageScore > best.averageScore) best = r;
  }

  const first = iterResults[0]?.averageScore || 0;
  const last = iterResults[iterResults.length - 1]?.averageScore || 0;
  const scoreProgression = iterResults.map(r => r.averageScore);

  return {
    scope,
    iterations: iterResults,
    best,
    finalSystem: currentSystem.snapshot ? currentSystem.snapshot() : null,
    scoreProgression,
    improved: last > first,
    totalWallTimeMs: Date.now() - startTime,
  };
}

/**
 * Format a LoopResult as a human-readable summary.
 */
export function summarize(result: LoopResult): string {
  const lines: string[] = [];
  lines.push(`=== Evolution Result ===`);
  lines.push(`Scope: ${result.scope.name} (${result.scope.path()})`);
  lines.push(`Iterations: ${result.iterations.length}`);
  lines.push(`Improved: ${result.improved ? "✓" : "✗"}`);
  lines.push(`Total time: ${result.totalWallTimeMs}ms`);
  lines.push("");
  lines.push(`Score progression:`);
  for (let i = 0; i < result.scoreProgression.length; i++) {
    const s = result.scoreProgression[i];
    const bar = "█".repeat(Math.round(s * 30));
    lines.push(`  iter ${String(i).padStart(2)}: ${s.toFixed(3)} ${bar}`);
  }
  lines.push("");
  lines.push(`Best iteration: ${result.best.iteration} (avg ${result.best.averageScore.toFixed(3)})`);
  lines.push(`Mutations applied: ${result.iterations.reduce((n, i) => n + i.mutations.length, 0)}`);
  return lines.join("\n");
}
