/**
 * @quilt/evolve — scope
 * ============================================================================
 * The Scope defines WHAT part of the system is being evolved.
 *
 * The same loop engine can evolve:
 *   - A single cell (improve one formula or prompt)
 *   - A sub-graph (improve an "organ")
 *   - The whole sheet (improve the "organism")
 *
 * Scopes are hierarchical: a cell-scope can be combined with a sheet-scope
 * to form "evolve the cell in the context of the sheet".
 *
 * ============================================================================
 */

import type { Scope, MutationCapability, Datum } from "./types.js";

/**
 * A whole-sheet scope. The mutator can change anything.
 */
export class FullSheetScope implements Scope {
  readonly name = "full-sheet";
  readonly capabilities: MutationCapability[] = [
    "formula", "prompt", "parameter", "structure", "value", "code",
  ];

  extract(system: Datum): Datum {
    return system;
  }

  apply(system: Datum, mutated: Datum): Datum {
    return mutated;  // the whole thing was replaced
  }

  path(): string {
    return "sheet:root";
  }
}

/**
 * A cell scope. Only mutates one cell.
 */
export class CellScope implements Scope {
  readonly name: string;
  readonly capabilities: MutationCapability[];
  private cellId: string;
  private allowedCaps: MutationCapability[];

  constructor(opts: { cellId: string; capabilities?: MutationCapability[]; name?: string }) {
    this.cellId = opts.cellId;
    this.allowedCaps = opts.capabilities || ["prompt", "parameter", "formula"];
    this.capabilities = this.allowedCaps;
    this.name = opts.name || `cell:${opts.cellId}`;
  }

  extract(system: Datum): Datum {
    if (typeof system !== "object" || system === null) return system;
    const sheet = system as any;
    if (sheet.cells && Array.isArray(sheet.cells)) {
      const cell = sheet.cells.find((c: any) => c.id === this.cellId);
      return cell || null;
    }
    return sheet[this.cellId];
  }

  apply(system: Datum, mutated: Datum): Datum {
    if (typeof system !== "object" || system === null) return system;
    const newSystem = JSON.parse(JSON.stringify(system));
    if ((newSystem as any).cells && Array.isArray((newSystem as any).cells)) {
      const cells = (newSystem as any).cells;
      const idx = cells.findIndex((c: any) => c.id === this.cellId);
      if (idx >= 0 && mutated) {
        cells[idx] = { ...cells[idx], ...mutated };
      }
    } else {
      (newSystem as any)[this.cellId] = mutated;
    }
    return newSystem;
  }

  path(): string {
    return `cell:${this.cellId}`;
  }
}

/**
 * A sub-graph scope. Mutates a set of cells.
 */
export class SubGraphScope implements Scope {
  readonly name: string;
  readonly capabilities: MutationCapability[];
  private cellIds: Set<string>;

  constructor(opts: { cellIds: string[]; name?: string; capabilities?: MutationCapability[] }) {
    this.cellIds = new Set(opts.cellIds);
    this.name = opts.name || `graph:${[...this.cellIds].join(",")}`;
    this.capabilities = opts.capabilities || ["formula", "prompt", "parameter", "structure"];
  }

  extract(system: Datum): Datum {
    if (typeof system !== "object" || system === null) return system;
    const sheet = system as any;
    if (sheet.cells && Array.isArray(sheet.cells)) {
      return {
        cells: sheet.cells.filter((c: any) => this.cellIds.has(c.id)),
        _scope: { cellIds: [...this.cellIds] },
      };
    }
    const result: any = {};
    for (const id of this.cellIds) {
      if (id in sheet) result[id] = (sheet as any)[id];
    }
    return result;
  }

  apply(system: Datum, mutated: Datum): Datum {
    if (typeof system !== "object" || system === null) return system;
    if (typeof mutated !== "object" || mutated === null) return system;
    const newSystem = JSON.parse(JSON.stringify(system));
    const mutatedAny = mutated as any;
    if ((newSystem as any).cells && Array.isArray((newSystem as any).cells) && mutatedAny.cells) {
      for (const mCell of mutatedAny.cells) {
        const idx = (newSystem as any).cells.findIndex((c: any) => c.id === mCell.id);
        if (idx >= 0) {
          (newSystem as any).cells[idx] = { ...(newSystem as any).cells[idx], ...mCell };
        }
      }
    } else {
      for (const id of this.cellIds) {
        if (id in mutatedAny) (newSystem as any)[id] = mutatedAny[id];
      }
    }
    return newSystem;
  }

  path(): string {
    return `graph:${[...this.cellIds].join("+")}`;
  }
}

/**
 * A program-code scope. Mutates the code of a program cell.
 */
export class ProgramCodeScope implements Scope {
  readonly name: string;
  readonly capabilities: MutationCapability[] = ["code"];
  private cellId: string;

  constructor(cellId: string) {
    this.cellId = cellId;
    this.name = `program:${cellId}`;
  }

  extract(system: Datum): Datum {
    if (typeof system !== "object" || system === null) return null;
    const sheet = system as any;
    if (sheet.cells) {
      const cell = sheet.cells.find((c: any) => c.id === this.cellId);
      return cell ? cell.code : null;
    }
    return (sheet as any)[this.cellId]?.code;
  }

  apply(system: Datum, mutated: Datum): Datum {
    if (typeof system !== "object" || system === null) return system;
    const newSystem = JSON.parse(JSON.stringify(system));
    if ((newSystem as any).cells) {
      const idx = (newSystem as any).cells.findIndex((c: any) => c.id === this.cellId);
      if (idx >= 0) (newSystem as any).cells[idx].code = mutated;
    } else {
      (newSystem as any)[this.cellId].code = mutated;
    }
    return newSystem;
  }

  path(): string {
    return `program:${this.cellId}`;
  }
}

/**
 * A hierarchical scope. Wraps multiple scopes, applies them in order.
 * Each scope sees only its part; the mutator mutates each in turn.
 */
export class HierarchicalScope implements Scope {
  readonly name: string;
  readonly capabilities: MutationCapability[];
  private scopes: Scope[];

  constructor(scopes: Scope[], name?: string) {
    this.scopes = scopes;
    this.name = name || `hier:${scopes.map(s => s.name).join(">")}`;
    const capSet = new Set<MutationCapability>();
    for (const s of scopes) {
      for (const c of s.capabilities) capSet.add(c);
    }
    this.capabilities = [...capSet];
  }

  extract(system: Datum): Datum {
    // Return all extractions as a map
    const result: any = {};
    for (const s of this.scopes) {
      result[s.name] = s.extract(system);
    }
    return result;
  }

  apply(system: Datum, mutated: Datum): Datum {
    if (typeof mutated !== "object" || mutated === null) return system;
    let result = system;
    for (const s of this.scopes) {
      if (s.name in (mutated as any)) {
        result = s.apply(result, (mutated as any)[s.name]);
      }
    }
    return result;
  }

  path(): string {
    return this.scopes.map(s => s.path()).join(">");
  }
}
