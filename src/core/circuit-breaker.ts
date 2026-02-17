/**
 * Circuit Breaker — Graceful degradation for external dependencies.
 */

// ── Types ──

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

// ── Circuit Breaker ──

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private halfOpenAttempts = 0;
  private halfOpenSuccesses = 0;
  private lastFailureTime = 0;
  private listeners: StateChangeCallback[] = [];
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /** Execute a function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.transition('HALF_OPEN');
      } else {
        throw new CircuitOpenError('Circuit breaker is OPEN');
      }
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        // Decide based on successes
        if (this.halfOpenSuccesses > 0) {
          this.reset();
        } else {
          this.trip();
          throw new CircuitOpenError('Circuit breaker tripped back to OPEN after HALF_OPEN');
        }
      }
    }

    try {
      if (this.state === 'HALF_OPEN') {
        this.halfOpenAttempts++;
      }
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Get the current state. */
  getState(): CircuitState {
    // Check for auto-transition
    if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
      this.transition('HALF_OPEN');
    }
    return this.state;
  }

  /** Register a state change callback. */
  onStateChange(callback: StateChangeCallback): void {
    this.listeners.push(callback);
  }

  /** Get failure count. */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** Manually reset the circuit breaker to CLOSED. */
  forceReset(): void {
    this.reset();
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= 1) {
        this.reset();
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.trip();
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.transition('OPEN');
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
  }

  private reset(): void {
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.transition('CLOSED');
  }

  private transition(to: CircuitState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    for (const cb of this.listeners) {
      cb(from, to);
    }
  }
}

/** Error thrown when the circuit is open. */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
