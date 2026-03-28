/**
 * Generic typed state machine for managing deterministic state transitions with guards
 */

export type StateTransitionGuard<Context = unknown> = (
  context: Context,
) => boolean;

export interface StateTransition<State, Context = unknown> {
  target: State;
  guard?: StateTransitionGuard<Context>;
  action?: (context: Context) => void;
}

export type StateTransitionMap<State extends string = string, EventType extends string = string, Context = unknown> = Partial<
  Record<EventType, StateTransition<State, Context> | State>
>;

export interface StateMachineConfig<State extends string = string, EventType extends string = string, Context = unknown> {
  initial: State;
  states: Record<State, StateTransitionMap<State, EventType, Context>>;
  context?: Context;
}

export interface StateMachineState<State, EventType extends string = string, Context = unknown> {
  state: State;
  context: Context;
  canTransition: (event: EventType) => boolean;
}

export class StateMachine<
  State extends string,
  EventType extends string,
  Context = unknown,
> {
  private currentState: State;
  private config: StateMachineConfig<State, EventType, Context>;
  private context: Context;
  private listeners: Set<(state: State, context: Context) => void> = new Set();
  private transitionHistory: Array<{
    from: State;
    to: State;
    event: EventType;
    timestamp: number;
  }> = [];

  constructor(config: StateMachineConfig<State, EventType, Context>) {
    this.config = config;
    this.currentState = config.initial;
    this.context = config.context as Context;
  }

  /**
   * Get current state and context
   */
  getState(): StateMachineState<State, EventType, Context> {
    return {
      state: this.currentState,
      context: this.context,
      canTransition: (event: EventType) => this.canTransition(event),
    };
  }

  /**
   * Check if a transition is valid for the current state
   */
  canTransition(event: EventType): boolean {
    const stateTransitions = this.config.states[this.currentState];
    if (!stateTransitions) return false;

    const transition = stateTransitions[event];
    if (!transition) return false;

    if (typeof transition === 'string') {
      return true;
    }

    if (transition.guard) {
      return transition.guard(this.context);
    }

    return true;
  }

  /**
   * Attempt a state transition
   */
  transition(event: EventType, contextUpdate?: Partial<Context>): boolean {
    const stateTransitions = this.config.states[this.currentState];
    if (!stateTransitions) return false;

    const transition = stateTransitions[event];
    if (!transition) return false;

    let targetState: State;
    let transitionConfig: StateTransition<State, Context> | null = null;

    if (typeof transition === 'string') {
      targetState = transition as State;
    } else {
      transitionConfig = transition;
      targetState = transition.target;

      // Check guard
      if (transitionConfig.guard && !transitionConfig.guard(this.context)) {
        return false;
      }
    }

    // Update context
    if (contextUpdate) {
      this.context = { ...this.context, ...contextUpdate };
    }

    // Execute action if defined
    if (transitionConfig?.action) {
      transitionConfig.action(this.context);
    }

    const previousState = this.currentState;
    this.currentState = targetState;

    // Record transition
    this.transitionHistory.push({
      from: previousState,
      to: targetState,
      event,
      timestamp: Date.now(),
    });

    // Notify listeners
    this.listeners.forEach((listener) => listener(this.currentState, this.context));

    return true;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: State, context: Context) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Force state change (use with caution - bypasses transitions)
   */
  setState(state: State, contextUpdate?: Partial<Context>): void {
    if (contextUpdate) {
      this.context = { ...this.context, ...contextUpdate };
    }
    const previousState = this.currentState;
    this.currentState = state;
    this.transitionHistory.push({
      from: previousState,
      to: state,
      event: '__forced__' as unknown as EventType,
      timestamp: Date.now(),
    });
    this.listeners.forEach((listener) => listener(this.currentState, this.context));
  }

  /**
   * Update context without changing state
   */
  updateContext(update: Partial<Context>): void {
    this.context = { ...this.context, ...update };
    this.listeners.forEach((listener) => listener(this.currentState, this.context));
  }

  /**
   * Get transition history
   */
  getHistory(): Array<{
    from: State;
    to: State;
    event: EventType;
    timestamp: number;
  }> {
    return [...this.transitionHistory];
  }

  /**
   * Reset to initial state
   */
  reset(contextReset?: Context): void {
    this.currentState = this.config.initial;
    this.context = contextReset ?? (this.config.context as Context);
    this.transitionHistory = [];
    this.listeners.forEach((listener) => listener(this.currentState, this.context));
  }

  /**
   * Get all valid transitions from current state
   */
  getValidTransitions(): EventType[] {
    const stateTransitions = this.config.states[this.currentState];
    if (!stateTransitions) return [];

    return (Object.keys(stateTransitions) as EventType[]).filter((event) =>
      this.canTransition(event),
    );
  }
}
