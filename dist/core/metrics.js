/**
 * Metrics & Observability — Internal metrics collection.
 */
function tagsKey(tags) {
    if (!tags || Object.keys(tags).length === 0)
        return '';
    return Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
}
// ── Metrics Collector ──
export class MetricsCollector {
    counters = new Map();
    gauges = new Map();
    histograms = new Map();
    adapters = [];
    /** Register an external metrics adapter. */
    registerAdapter(adapter) {
        this.adapters.push(adapter);
    }
    /** Increment a counter by 1 (or by `amount`). */
    counter(name, tags, amount = 1) {
        const key = tagsKey(tags);
        let byTags = this.counters.get(name);
        if (!byTags) {
            byTags = new Map();
            this.counters.set(name, byTags);
        }
        const existing = byTags.get(key);
        if (existing) {
            existing.value += amount;
        }
        else {
            byTags.set(key, { value: amount, tags });
        }
        for (const a of this.adapters)
            a.onCounter(name, amount, tags);
    }
    /** Set a gauge value. */
    gauge(name, value, tags) {
        const key = tagsKey(tags);
        let byTags = this.gauges.get(name);
        if (!byTags) {
            byTags = new Map();
            this.gauges.set(name, byTags);
        }
        byTags.set(key, { value, tags });
        for (const a of this.adapters)
            a.onGauge(name, value, tags);
    }
    /** Record a histogram value. */
    histogram(name, value, tags) {
        const key = tagsKey(tags);
        let byTags = this.histograms.get(name);
        if (!byTags) {
            byTags = new Map();
            this.histograms.set(name, byTags);
        }
        const existing = byTags.get(key);
        if (existing) {
            existing.values.push(value);
        }
        else {
            byTags.set(key, { values: [value], tags });
        }
        for (const a of this.adapters)
            a.onHistogram(name, value, tags);
    }
    /** Get a snapshot of all metrics. */
    getSnapshot() {
        const counters = {};
        for (const [name, byTags] of this.counters) {
            counters[name] = Array.from(byTags.values());
        }
        const gauges = {};
        for (const [name, byTags] of this.gauges) {
            gauges[name] = Array.from(byTags.values());
        }
        const histograms = {};
        for (const [name, byTags] of this.histograms) {
            histograms[name] = Array.from(byTags.values());
        }
        return { counters, gauges, histograms, collectedAt: new Date().toISOString() };
    }
    /** Reset all metrics. */
    reset() {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }
    /** Get a single counter value (sum across all tag combinations, or for specific tags). */
    getCounter(name, tags) {
        const byTags = this.counters.get(name);
        if (!byTags)
            return 0;
        if (tags) {
            const entry = byTags.get(tagsKey(tags));
            return entry?.value ?? 0;
        }
        let total = 0;
        for (const entry of byTags.values())
            total += entry.value;
        return total;
    }
    /** Get a single gauge value. */
    getGauge(name, tags) {
        const byTags = this.gauges.get(name);
        if (!byTags)
            return undefined;
        const entry = byTags.get(tagsKey(tags));
        return entry?.value;
    }
    /** Get histogram values. */
    getHistogramValues(name, tags) {
        const byTags = this.histograms.get(name);
        if (!byTags)
            return [];
        if (tags) {
            const entry = byTags.get(tagsKey(tags));
            return entry?.values ?? [];
        }
        const all = [];
        for (const entry of byTags.values())
            all.push(...entry.values);
        return all;
    }
}
/** Global metrics instance (singleton for convenience). */
export const globalMetrics = new MetricsCollector();
