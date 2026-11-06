export type GameTopology = 'grid-2d' | 'layered-planar' | 'planar-graph';

export interface RuntimeSchema<T> {
  id: string;
  version: string;
  parse(value: unknown): T;
  serialize(value: T): unknown;
}

export interface GameRuntimeContext {
  seed: number;
  stepIndex: number;
}

export interface GameRuntime<Config, State, Action, Resolution> {
  createInitialState(config: Config, seed: number): State;
  hashState(state: State): string;
  listLegalActions?(state: State): Action[];
  resolve(state: State, action: Action, context: GameRuntimeContext): Resolution;
  stateAfter(resolution: Resolution): State;
}

export interface GameManifest {
  gameId: string;
  moduleVersion: string;
  displayName: string;
  topology: GameTopology;
  rulesetId?: string;
  rulesetVersion?: string;
  /** Optional platform capabilities. A capability never changes the generic Runtime contract. */
  capabilities?: string[];
}

export interface GameSchemas<Config, State, Action, ReplayAction = Action> {
  config: RuntimeSchema<Config>;
  state: RuntimeSchema<State>;
  /** Rule-semantic action. Pointer timing belongs on Interaction Records. */
  action: RuntimeSchema<Action>;
  replayAction?: RuntimeSchema<ReplayAction>;
}

export interface GameDefinition<Config, State, Action, Resolution> {
  manifest: GameManifest;
  schemas: GameSchemas<Config, State, Action>;
  runtime: GameRuntime<Config, State, Action, Resolution>;
}

export type AnyGameDefinition = GameDefinition<any, any, any, any>;
