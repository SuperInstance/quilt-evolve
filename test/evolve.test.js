/**
 * Tests for @quilt/evolve — uses mock AI engine (no real API calls).
 */

const assert = require("assert");
const { execSync } = require("child_process");

// Build the dist
console.log("Building dist...");
execSync("npx tsc", { cwd: __dirname + "/..", stdio: "inherit" });

const {
  evolve,
  summarize,
  FunctionSystem,
  SeededGenerator,
  HeuristicJudge,
  NoOpMutator,
  FullSheetScope,
  CellScope,
  SubGraphScope,
  ProgramCodeScope,
  HierarchicalScope,
} = require("../dist/index.js");

let testCount = 0;
let passCount = 0;

async function test(name, fn) {
  testCount++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    console.log(e.stack);
  }
}

(async () => {
  console.log("\n=== Scope tests ===");

  await test("FullSheetScope returns the whole system", () => {
    const scope = new FullSheetScope();
    const system = { cells: [{ id: "a" }] };
    const extracted = scope.extract(system);
    assert.deepStrictEqual(extracted, system);
    assert.strictEqual(scope.path(), "sheet:root");
  });

  await test("CellScope extracts a single cell", () => {
    const scope = new CellScope({ cellId: "a", capabilities: ["prompt"] });
    const system = { cells: [{ id: "a", value: 1 }, { id: "b", value: 2 }] };
    const extracted = scope.extract(system);
    assert.deepStrictEqual(extracted, { id: "a", value: 1 });
    assert.strictEqual(scope.path(), "cell:a");
  });

  await test("CellScope applies mutation back to sheet", () => {
    const scope = new CellScope({ cellId: "a" });
    const system = { cells: [{ id: "a", value: 1 }] };
    const mutated = { id: "a", value: 99 };
    const result = scope.apply(system, mutated);
    assert.strictEqual(result.cells[0].value, 99);
  });

  await test("SubGraphScope extracts multiple cells", () => {
    const scope = new SubGraphScope({ cellIds: ["a", "c"] });
    const system = { cells: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const extracted = scope.extract(system);
    assert.strictEqual(extracted.cells.length, 2);
    assert.deepStrictEqual(extracted.cells.map(c => c.id), ["a", "c"]);
  });

  await test("ProgramCodeScope extracts code", () => {
    const scope = new ProgramCodeScope("p1");
    const system = { cells: [{ id: "p1", code: "return x+1" }] };
    const extracted = scope.extract(system);
    assert.strictEqual(extracted, "return x+1");
  });

  await test("HierarchicalScope combines scopes", () => {
    const scope = new HierarchicalScope([
      new CellScope({ cellId: "a" }),
      new CellScope({ cellId: "b" }),
    ]);
    const system = { cells: [{ id: "a" }, { id: "b" }] };
    const extracted = scope.extract(system);
    assert.deepStrictEqual(Object.keys(extracted), ["cell:a", "cell:b"]);
  });

  console.log("\n=== Generator tests ===");

  await test("SeededGenerator returns inputs in order", async () => {
    const gen = new SeededGenerator(["a", "b", "c", "d", "e"]);
    const inputs1 = await gen.generate({ iteration: 0 });
    const inputs2 = await gen.generate({ iteration: 1 });
    assert.deepStrictEqual(inputs1, ["a", "b", "c", "d", "e"]);
    assert.deepStrictEqual(inputs2, ["a", "b", "c", "d", "e"]);  // cycles
  });

  console.log("\n=== Judge tests ===");

  await test("HeuristicJudge scores based on rule", async () => {
    const judge = new HeuristicJudge({
      fn: (input, output) => output === "expected" ? 1 : 0,
      reasoningFn: (input, output) => `output was ${output}`,
    });
    const score = await judge.judge({ input: "x", output: "expected" });
    assert.strictEqual(score.value, 1);
    const badScore = await judge.judge({ input: "x", output: "wrong" });
    assert.strictEqual(badScore.value, 0);
  });

  console.log("\n=== System tests ===");

  await test("FunctionSystem runs a function and snapshots", async () => {
    const sys = new FunctionSystem({ name: "test", fn: (x) => x.value * 2 });
    const out = await sys.run({ value: 5 });
    assert.strictEqual(out, 10);
    const snap = sys.snapshot();
    assert.strictEqual(snap.historyLength, 1);
  });

  console.log("\n=== Loop tests ===");

  await test("evolve runs N iterations and tracks progress", async () => {
    let callCount = 0;
    const sys = new FunctionSystem({
      name: "doubler",
      fn: (x) => ({ result: x * 2, iteration: callCount }),
    });

    const gen = new SeededGenerator([1, 2, 3, 4, 5]);
    const judge = new HeuristicJudge({
      fn: (input, output) => output.result === input * 2 ? 1 : 0,
    });
    const mutator = new NoOpMutator();
    const scope = new FullSheetScope();

    const result = await evolve({
      system: sys,
      generator: gen,
      judge,
      mutator,
      scope,
      iterations: 3,
      populationSize: 3,
    });

    assert.strictEqual(result.iterations.length, 3);
    assert.strictEqual(result.scoreProgression.length, 3);
    assert.strictEqual(result.improved, false);  // no mutation, no improvement
    assert.strictEqual(result.scoreProgression[0], 1.0);  // all correct
  });

  await test("evolve with no mutator still produces results", async () => {
    const sys = new FunctionSystem({ name: "echo", fn: (x) => x });
    const gen = new SeededGenerator(["hi"]);
    const judge = new HeuristicJudge({ fn: (i, o) => o === i ? 1 : 0 });
    const scope = new FullSheetScope();

    const result = await evolve({
      system: sys,
      generator: gen,
      judge,
      scope,
      iterations: 2,
      populationSize: 1,
    });

    assert.strictEqual(result.iterations.length, 2);
    assert.strictEqual(result.improved, false);
  });

  await test("evolve early-stops on plateau", async () => {
    const sys = new FunctionSystem({ name: "noop", fn: (x) => x });
    const gen = new SeededGenerator([1, 2, 3]);
    const judge = new HeuristicJudge({ fn: () => 0.5 });  // always 0.5
    const scope = new FullSheetScope();

    const result = await evolve({
      system: sys,
      generator: gen,
      judge,
      scope,
      iterations: 20,
      populationSize: 3,
      plateauThreshold: 3,
    });

    // Should stop early (after 3 iterations of no improvement)
    assert(result.iterations.length < 20, `expected to stop early but ran ${result.iterations.length} iterations`);
  });

  await test("summarize() formats the result", async () => {
    const sys = new FunctionSystem({ name: "x", fn: (x) => x });
    const gen = new SeededGenerator([1]);
    const judge = new HeuristicJudge({ fn: () => 0.7 });
    const scope = new FullSheetScope();

    const result = await evolve({
      system: sys,
      generator: gen,
      judge,
      scope,
      iterations: 2,
      populationSize: 1,
    });

    const text = summarize(result);
    assert(text.includes("Evolution Result"));
    assert(text.includes("iter"));
    assert(text.includes("0.700"));
  });

  console.log(`\n=== ${passCount}/${testCount} tests passed ===`);
  process.exit(passCount === testCount ? 0 : 1);
})();
