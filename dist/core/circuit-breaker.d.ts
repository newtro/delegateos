/**
 * Circuit Breaker — Graceful degradation for external dependencies.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface CircuitBreakerConfig {
    /** Number of failures before tripping to OPEN */
    failureThreshold: number;
    /** Time in ms before transitioning from OPEN to HALF_OPEN */
    resetTimeoutMs: number;
    /** Max attempts in HALF_OPEN before deciding */
    halfOpenMaxAttempts: number;
}
export type StateChangeCallback = (from: CircuitState, to: CircuitState) => void;
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private halfOpenAttempts;
    private halfOpenSuccesses;
    private lastFailureTime;
    private listeners;
    private config;
    constructor(config: CircuitBreakerConfig);
    /** Execute a function through the circuit breaker. */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /** Get the current state. */
    getState(): CircuitState;
    /** Register a state change callback. */
    onStateChange(callback: StateChangeCallback): void;
    /** Get failure count. */
    getFailureCount(): number;
    /** Manually reset the circuit breaker to CLOSED. */
    forceReset(): void;
    private onSuccess;
    private onFailure;
    private trip;
    private reset;
    private transition;
}
/** Error thrown when the circuit is open. */
export declare class CircuitOpenError extends Error {
    constructor(message: string);
}
