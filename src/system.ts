/**
 * @quilt/evolve — system adapter
 * ============================================================================
 * Wraps a Quilt sheet (or any function) as a System that can be evolved.
 *
 * Usage:
 *   const system = new QuiltSystem(engine, 'output-cell-id');
 *   const result = await system.run({ question: 'What is Quilt?' });
 *
 * The system:
 *   - Sets the input cell(s) to the given value
 *   - Reads the output cell(s)
 *   - Snapshots and restores the entire engine for mutations
 * ============================================================================
 */

import type { System, Datum } from "./types.js";

/**
 * Wrap a function as a System. Simplest possible.
 */
export class FunctionSystem implements System {
  readonly name: string;
  readonly description?: string;
  private currentFn: (input: Datum) => Promise<Datum> | Datum;
  private history: Datum[] = [];

  constructor(opts: {
    name: string;
    description?: string;
    fn: (input: Datum) => Promise<Datum> | Datum;
  }) {
    this.name = opts.name;
    this.description = opts.description;
    this.currentFn = opts.fn;
  }

  async run(input: Datum): Promise<Datum> {
    const out = await this.currentFn(input);
    this.history.push(input);
    return out;
  }

  snapshot(): Datum {
    return {
      historyLength: this.history.length,
      // We can't snapshot the function itself, but we can snapshot the history
    };
  }

  restore(snapshot: Datum): void {
    if (typeof snapshot === "object" && snapshot && "historyLength" in snapshot) {
      this.history = this.history.slice(0, (snapshot as any).historyLength);
    }
  }

  /** Replace the underlying function. Used by mutators. */
  setFn(fn: (input: Datum) => Promise<Datum> | Datum): void {
    this.currentFn = fn;
  }

  /** Get the current function. */
  getFn(): (input: Datum) => Promise<Datum> | Datum {
    return this.currentFn;
  }
}

/**
 * Wrap a QuiltEngine as a System. The engine must have a designated
 * input cell and output cell.
 */
export class QuiltSystem implements System {
  readonly name: string;
  readonly description?: string;
  private engine: any;
  private inputCell: string;
  private outputCell: string;
  private contextCells: string[];

  constructor(opts: {
    name: string;
    description?: string;
    engine: any;  // QuiltEngine
    inputCell: string;
    outputCell: string;
    contextCells?: string[];
  }) {
    this.name = opts.name;
    this.description = opts.description;
    this.engine = opts.engine;
    this.inputCell = opts.inputCell;
    this.outputCell = opts.outputCell;
    this.contextCells = opts.contextCells || [];
  }

  async run(input: Datum): Promise<Datum> {
    // Set the input cell
    await this.engine.set(this.inputCell, input);
    // Set context cells
    if (typeof input === "object" && input !== null) {
      for (const ctxCell of this.contextCells) {
        if (ctxCell in (input as any)) {
          await this.engine.set(ctxCell, (input as any)[ctxCell]);
        }
      }
    }
    // Get the output
    const v = await this.engine.get(this.outputCell);
    return v.data;
  }

  snapshot(): Datum {
    // Deep clone the current sheet
    const sheet = this.engine.snapshot ? this.engine.snapshot() : null;
    return sheet;
  }

  restore(snapshot: Datum): void {
    if (this.engine.restore && snapshot) {
      this.engine.restore(snapshot);
    }
  }
}
