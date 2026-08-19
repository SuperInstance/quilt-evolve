# @quilt/evolve — self-improvement loops for Quilt

> **4 components. 1 loop. Any scope.**

Self-improvement loops for Quilt sheets. LLMs as adversarial input generators and output judges. The system mutates itself based on feedback. Run the loop at any scope: a single cell, a sub-graph, or the whole sheet.

```
   ┌──────────────────────────────────────────────────────────────┐
   │  THE EVOLUTION LOOP                                          │
   │                                                              │
   │   Generator (LLM)     System (Quilt sheet)    Judge (LLM)   │
   │   ─────────────       ─────────────────────   ────────────   │
   │                                                              │
   │   "What should       ┌──────────────┐       "How good       │
   │    I test?"  ──────▶ │  process()   │ ────▶  is this?"      │
   │                       └──────────────┘                        │
   │                              │                                │
   │                              ▼                                │
   │                       ┌──────────────┐                        │
   │                       │  Mutator     │                        │
   │                       │  (LLM)       │                        │
   │                       │              │                        │
   │                       │ "What should │                        │
   │                       │  change?"    │                        │
   │                       └──────────────┘                        │
   │                              │                                │
   │                              ▼                                │
   │                       next iteration                          │
   │                       (informed by                            │
   │                        previous outputs)                      │
   └──────────────────────────────────────────────────────────────┘
```

## Install

```bash
npm install @quilt/evolve
```

## Quick start

```typescript
import {
  evolve, FunctionSystem, LLMGenerator, LLMJudge, LLMMutator, CellScope,
} from '@quilt/evolve';
import { AIEngine } from '@quilt/ai';

const ai = new AIEngine({ zaiKey: process.env.ZAI_TOKEN });

// Your system — a function or a Quilt sheet
const system = new FunctionSystem({
  name: 'summarizer',
  fn: (text) => mySummarizeFn(text),
});

const result = await evolve({
  system,
  generator: new LLMGenerator({
    ai,
    task: 'Summarize the input text in 30 words or fewer',
    inputFormat: 'English text',
    outputDescription: 'A 30-word summary',
  }),
  judge: new LLMJudge({
    ai,
    task: 'Summarize text',
    criteria: ['conciseness', 'accuracy', 'completeness'],
  }),
  mutator: new LLMMutator({
    ai,
    task: 'Summarize text',
    capabilities: ['prompt'],
  }),
  scope: new CellScope({ cellId: 'summary', capabilities: ['prompt'] }),
  iterations: 10,
  populationSize: 5,
});

console.log(result.scoreProgression);  // [0.4, 0.5, 0.6, ...]
console.log(result.improved);          // true
```

## The 4 components

### Generator

Creates adversarial inputs. Uses an LLM to look at previous outputs and find weaknesses.

```typescript
const gen = new LLMGenerator({
  ai,
  task: 'Translate to French',
  inputFormat: 'English text',
  outputDescription: 'Accurate French translation',
  count: 5,           // how many inputs per iteration
  temperature: 0.9,   // high = diverse
  focusAreas: ['idioms', 'technical terms', 'ambiguous sentences'],
  examples: [{ input: 'Hello', output: 'Bonjour' }],
});
```

Other generators:
- `SeededGenerator` — fixed pool, no LLM
- `PerturbationGenerator` — perturbs a base input using LLM

### Judge

Scores (input, output) pairs. Returns a [0, 1] score + reasoning + structured feedback.

```typescript
const judge = new LLMJudge({
  ai,
  task: 'Translate to French',
  criteria: ['accuracy', 'fluency', 'conciseness'],
  weights: [0.5, 0.3, 0.2],
});
```

Other judges:
- `HeuristicJudge` — rule-based, no LLM
- `ExactMatchJudge` — for exact-match tasks

### Mutator

Applies feedback to the system. Uses an LLM to generate specific mutations.

```typescript
const mutator = new LLMMutator({
  ai,
  task: 'Translate to French',
  capabilities: ['prompt', 'parameter'],
  threshold: 0.95,    // don't mutate if score is already 0.95+
  maxMutations: 1,   // how many changes per iteration
});
```

Other mutators:
- `NoOpMutator` — for measuring baseline
- `FixedMutator` — always applies the same change

### System

Wraps your code as something the loop can run.

```typescript
// Wrap a function
const system = new FunctionSystem({
  name: 'my-summarizer',
  fn: (input) => mySummarizeFn(input),
});

// Or wrap a Quilt sheet
const system = new QuiltSystem({
  name: 'quilt-summarizer',
  engine: myQuiltEngine,
  inputCell: 'input.text',
  outputCell: 'summary',
});
```

## The 5 scopes

The scope determines WHAT part of the system is evolved.

| Scope | Evolves | Example |
|-------|---------|---------|
| `FullSheetScope` | Everything | The whole organism |
| `CellScope` | One cell | Just the LLM prompt |
| `SubGraphScope` | A group of cells | An "organ" (e.g., the router) |
| `ProgramCodeScope` | The code of one cell | The function body |
| `HierarchicalScope` | Nested scopes | Cell → Organ → Organism |

```typescript
// Evolve one cell
new CellScope({ cellId: 'summary', capabilities: ['prompt'] });

// Evolve a sub-graph
new SubGraphScope({ cellIds: ['intent', 'route', 'do.translate'] });

// Hierarchical: evolve the cell, then the organ containing it
new HierarchicalScope([
  new CellScope({ cellId: 'summary' }),
  new SubGraphScope({ cellIds: ['summary', 'display'] }),
]);
```

## The loop

```typescript
const result = await evolve({
  system, generator, judge, mutator, scope,
  iterations: 10,
  populationSize: 5,
  plateauThreshold: 3,  // stop after 3 iters of no improvement
  onIteration: (iter) => {
    console.log(`iter ${iter.iteration}: avg=${iter.averageScore}`);
  },
});

// Result shape
result.iterations           // all iterations
result.best                 // the best iteration
result.scoreProgression     // [0.4, 0.5, 0.6, ...]
result.improved             // was last score > first score?
result.finalSystem          // the final (mutated) system
```

## Examples

See [`examples/`](./examples):

- `01-summarizer.yaml` — improve a summarizer's prompt
- `02-classifier.yaml` — improve a sentiment classifier
- `03-router.yaml` — improve a router that picks downstream cells

## Test

```bash
npm test
```

13 unit tests, all pass. No real API calls (uses mock AI engine).

## Part of Quilt

`@quilt/evolve` is the 14th package in the Quilt ecosystem:

| Package | Description |
|---------|-------------|
| [@quilt/core](https://github.com/SuperInstance/quilt) | Reactive engine |
| [@quilt/cli](https://github.com/SuperInstance/quilt) | CLI + MCP server |
| [@quilt/ai](https://github.com/SuperInstance/quilt-ai) | AI cells (4 providers, 8 kinds) |
| **@quilt/evolve** (this) | Self-improvement loops |
| [quilt-rust](https://github.com/SuperInstance/quilt-rust) | Sync + async engine |
| [quilt-live](https://github.com/SuperInstance/quilt-live) | Single-file, offline |
| [quilt-cloudflare](https://github.com/SuperInstance/quilt-cloudflare) | Edge-native |
| [quilt-esp32](https://github.com/SuperInstance/quilt-esp32) | Microcontroller |
| [quilt-mesh](https://github.com/SuperInstance/quilt-mesh) | CRDT peer-to-peer |
| [quilt-agent](https://github.com/SuperInstance/quilt-agent) | LLM agent sheet |
| [quilt-time](https://github.com/SuperInstance/quilt-time) | Time travel |
| [quilt-vault](https://github.com/SuperInstance/quilt-vault) | Encryption |
| [quilt-vision](https://github.com/SuperInstance/quilt-vision) | Computer vision |
| [quilt-zk](https://github.com/SuperInstance/quilt-zk) | Zero-knowledge proofs |
| [quilt-flow](https://github.com/SuperInstance/quilt-flow) | Visual editor |

## License

MIT
