/**
 * Metrics & Observability — Internal metrics collection.
 */

// ── Types ──

export interface MetricsSnapshot {
  counters: Record<string, { value: number; tags?: Record<string, string> }[]>;
  gauges: Record<string, { value: number; tags?: Record<string, string> }[]>;
  histograms: Record<string, { values: number[]; tags?: Record<string, string> }[]>;
  collectedAt: string;
}

/** Adapter interface for external metrics systems (Prometheus, StatsD, etc.) */
export interface MetricsAdapter {
  onCounter(name: string, value: number, tags?: Record<string, string>): void;
  onGauge(name: string, value: number, tags?: Record<string, string>): void;
  onHistogram(name: string, value: number, tags?: Record<string, string>): void;
}

// ── Internal Storage ──

interface CounterEntry {
  value: number;
  tags?: Record<string, string>;
}

interface GaugeEntry {
  value: number;
  tags?: Record<string, string>;
}

interface HistogramEntry {
  values: number[];
  tags?: Record<string, string>;
}

function tagsKey(tags?: Record<string, string>): string {
  if (!tags || Object.keys(tags).length === 0) return '';
  return Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
}

// ── Metrics Collector ──

export class MetricsCollector {
  private counters = new Map<string, Map<string, CounterEntry>>();
  private gauges = new Map<string, Map<string, GaugeEntry>>();
  private histograms = new Map<string, Map<string, HistogramEntry>>();
  private adapters: MetricsAdapter[] = [];

  /** Register an external metrics adapter. */
  registerAdapter(adapter: MetricsAdapter): void {
    this.adapters.push(adapter);
  }

  /** Increment a counter by 1 (or by `amount`). */
  counter(name: string, tags?: Record<string, string>, amount = 1): void {
    const key = tagsKey(tags);
    let byTags = this.counters.get(name);
    if (!byTags) {
      byTags = new Map();
      this.counters.set(name, byTags);
    }
    const existing = byTags.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      byTags.set(key, { value: amount, tags });
    }
    for (const a of this.adapters) a.onCounter(name, amount, tags);
  }

  /** Set a gauge value. */
  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = tagsKey(tags);
    let byTags = this.gauges.get(name);
    if (!byTags) {
      byTags = new Map();
      this.gauges.set(name, byTags);
    }
    byTags.set(key, { value, tags });
    for (const a of this.adapters) a.onGauge(name, value, tags);
  }

  /** Record a histogram value. */
  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = tagsKey(tags);
    let byTags = this.histograms.get(name);
    if (!byTags) {
      byTags = new Map();
      this.histograms.set(name, byTags);
    }
    const existing = byTags.get(key);
    if (existing) {
      existing.values.push(value);
    } else {
      byTags.set(key, { values: [value], tags });
    }
    for (const a of this.adapters) a.onHistogram(name, value, tags);
  }

  /** Get a snapshot of all metrics. */
  getSnapshot(): MetricsSnapshot {
    const counters: MetricsSnapshot['counters'] = {};
    for (const [name, byTags] of this.counters) {
      counters[name] = Array.from(byTags.values());
    }

    const gauges: MetricsSnapshot['gauges'] = {};
    for (const [name, byTags] of this.gauges) {
      gauges[name] = Array.from(byTags.values());
    }

    const histograms: MetricsSnapshot['histograms'] = {};
    for (const [name, byTags] of this.histograms) {
      histograms[name] = Array.from(byTags.values());
    }

    return { counters, gauges, histograms, collectedAt: new Date().toISOString() };
  }

  /** Reset all metrics. */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  /** Get a single counter value (sum across all tag combinations, or for specific tags). */
  getCounter(name: string, tags?: Record<string, string>): number {
    const byTags = this.counters.get(name);
    if (!byTags) return 0;
    if (tags) {
      const entry = byTags.get(tagsKey(tags));
      return entry?.value ?? 0;
    }
    let total = 0;
    for (const entry of byTags.values()) total += entry.value;
    return total;
  }

  /** Get a single gauge value. */
  getGauge(name: string, tags?: Record<string, string>): number | undefined {
    const byTags = this.gauges.get(name);
    if (!byTags) return undefined;
    const entry = byTags.get(tagsKey(tags));
    return entry?.value;
  }

  /** Get histogram values. */
  getHistogramValues(name: string, tags?: Record<string, string>): number[] {
    const byTags = this.histograms.get(name);
    if (!byTags) return [];
    if (tags) {
      const entry = byTags.get(tagsKey(tags));
      return entry?.values ?? [];
    }
    const all: number[] = [];
    for (const entry of byTags.values()) all.push(...entry.values);
    return all;
  }
}

/** Global metrics instance (singleton for convenience). */
export const globalMetrics = new MetricsCollector();
