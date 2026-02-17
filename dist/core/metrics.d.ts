/**
 * Metrics & Observability — Internal metrics collection.
 */
export interface MetricsSnapshot {
    counters: Record<string, {
        value: number;
        tags?: Record<string, string>;
    }[]>;
    gauges: Record<string, {
        value: number;
        tags?: Record<string, string>;
    }[]>;
    histograms: Record<string, {
        values: number[];
        tags?: Record<string, string>;
    }[]>;
    collectedAt: string;
}
/** Adapter interface for external metrics systems (Prometheus, StatsD, etc.) */
export interface MetricsAdapter {
    onCounter(name: string, value: number, tags?: Record<string, string>): void;
    onGauge(name: string, value: number, tags?: Record<string, string>): void;
    onHistogram(name: string, value: number, tags?: Record<string, string>): void;
}
export declare class MetricsCollector {
    private counters;
    private gauges;
    private histograms;
    private adapters;
    /** Register an external metrics adapter. */
    registerAdapter(adapter: MetricsAdapter): void;
    /** Increment a counter by 1 (or by `amount`). */
    counter(name: string, tags?: Record<string, string>, amount?: number): void;
    /** Set a gauge value. */
    gauge(name: string, value: number, tags?: Record<string, string>): void;
    /** Record a histogram value. */
    histogram(name: string, value: number, tags?: Record<string, string>): void;
    /** Get a snapshot of all metrics. */
    getSnapshot(): MetricsSnapshot;
    /** Reset all metrics. */
    reset(): void;
    /** Get a single counter value (sum across all tag combinations, or for specific tags). */
    getCounter(name: string, tags?: Record<string, string>): number;
    /** Get a single gauge value. */
    getGauge(name: string, tags?: Record<string, string>): number | undefined;
    /** Get histogram values. */
    getHistogramValues(name: string, tags?: Record<string, string>): number[];
}
/** Global metrics instance (singleton for convenience). */
export declare const globalMetrics: MetricsCollector;
