/**
 * Circuit Breaker — Graceful degradation for external dependencies.
 */
// ── Circuit Breaker ──
export class CircuitBreaker {
    state = 'CLOSED';
    failureCount = 0;
    halfOpenAttempts = 0;
    halfOpenSuccesses = 0;
    lastFailureTime = 0;
    listeners = [];
    config;
    constructor(config) {
        this.config = config;
    }
    /** Execute a function through the circuit breaker. */
    async execute(fn) {
        if (this.state === 'OPEN') {
            // Check if reset timeout has elapsed
            if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
                this.transition('HALF_OPEN');
            }
            else {
                throw new CircuitOpenError('Circuit breaker is OPEN');
            }
        }
        if (this.state === 'HALF_OPEN') {
            if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
                // Decide based on successes
                if (this.halfOpenSuccesses > 0) {
                    this.reset();
                }
                else {
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
        }
        catch (err) {
            this.onFailure();
            throw err;
        }
    }
    /** Get the current state. */
    getState() {
        // Check for auto-transition
        if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
            this.transition('HALF_OPEN');
        }
        return this.state;
    }
    /** Register a state change callback. */
    onStateChange(callback) {
        this.listeners.push(callback);
    }
    /** Get failure count. */
    getFailureCount() {
        return this.failureCount;
    }
    /** Manually reset the circuit breaker to CLOSED. */
    forceReset() {
        this.reset();
    }
    onSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.halfOpenSuccesses++;
            if (this.halfOpenSuccesses >= 1) {
                this.reset();
            }
        }
        else {
            this.failureCount = 0;
        }
    }
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.state === 'HALF_OPEN') {
            this.trip();
        }
        else if (this.failureCount >= this.config.failureThreshold) {
            this.trip();
        }
    }
    trip() {
        this.transition('OPEN');
        this.halfOpenAttempts = 0;
        this.halfOpenSuccesses = 0;
    }
    reset() {
        this.failureCount = 0;
        this.halfOpenAttempts = 0;
        this.halfOpenSuccesses = 0;
        this.transition('CLOSED');
    }
    transition(to) {
        if (this.state === to)
            return;
        const from = this.state;
        this.state = to;
        for (const cb of this.listeners) {
            cb(from, to);
        }
    }
}
/** Error thrown when the circuit is open. */
export class CircuitOpenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CircuitOpenError';
    }
}
