// The game state. Plain data throughout, so the server can store it and send
// it to clients as JSON. Page numbers are the 2023 rulebook's printed pages.

/** A square on the grid: `col` runs west to east, `row` north to south. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** A battlefield space's terrain (p19). A wall is tracked separately, with its hit points. */
export interface Terrain {
  /** One abstract level up: +1 to enter from the ground, cover for units below it. */
  readonly elevated?: boolean;
  /** Lets units skip the cost of climbing onto elevation. */
  readonly stairs?: boolean;
  /** 1 damage, ignoring armor, to a unit starting its turn here or entering it on its turn. */
  readonly hazard?: boolean;
  /** Costs +1 movement to leave. */
  readonly adverse?: boolean;
}

export interface Board {
  /** Squares per side: 6, 8 or 10. */
  readonly size: number;
  /** Terrain by `row * size + col`. */
  readonly terrain: Terrain[];
  /** Wall hit points by `row * size + col`; 0 where there is no wall. A wall has 2 (p19). */
  readonly walls: number[];
  /** Corpses lying in each space by `row * size + col` (p14). */
  readonly corpses: number[];
}

export type Token = "strength" | "weak" | "vitality" | "vulnerable" | "speed" | "slow";
export type Tokens = Partial<Record<Token, number>>;

/** A unit on the battlefield. Its stats and abilities come from its kind (see content). */
export interface Unit {
  readonly id: string;
  readonly side: number;
  /** The unit definition's id. */
  readonly kind: string;
  /** Its north-west square. */
  col: number;
  row: number;
  /** Squares per side of its footprint: 1, or 2 for a tyrant. */
  readonly size: 1 | 2;
  hp: number;
  tokens: Tokens;
  /** Whether it has taken its turn this round. */
  done: boolean;
  /** Abilities it has used that must be reloaded before their next use. */
  unloaded: string[];
}
