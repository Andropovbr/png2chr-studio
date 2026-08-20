export type StateUpdater<TState> = TState | ((current: TState) => TState);

export interface StateUpdateResult<TState> {
  readonly value: TState;
  readonly marksProjectDirty: boolean;
}

function resolveStateUpdate<TState>(
  current: TState,
  updater: StateUpdater<TState>,
): TState {
  return typeof updater === 'function'
    ? (updater as (current: TState) => TState)(current)
    : updater;
}

export function applyProjectUpdate<TState>(
  current: TState,
  updater: StateUpdater<TState>,
): StateUpdateResult<TState> {
  const value = resolveStateUpdate(current, updater);
  return {
    value,
    marksProjectDirty: value !== current,
  };
}

export function applyWorkspaceUpdate<TState>(
  current: TState,
  updater: StateUpdater<TState>,
): StateUpdateResult<TState> {
  return {
    value: resolveStateUpdate(current, updater),
    marksProjectDirty: false,
  };
}

export function applyDerivedStatusUpdate<TState>(
  current: TState,
  updater: StateUpdater<TState>,
): StateUpdateResult<TState> {
  return {
    value: resolveStateUpdate(current, updater),
    marksProjectDirty: false,
  };
}
