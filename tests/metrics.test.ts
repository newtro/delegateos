import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../src/core/metrics.js';
import type { MetricsAdapter } from '../src/core/metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('counters', () => {
    it('increments counter', () => {
      metrics.counter('requests');
      metrics.counter('requests');
      expect(metrics.getCounter('requests')).toBe(2);
    });

    it('increments by custom amount', () => {
      metrics.counter('bytes', undefined, 1024);
      expect(metrics.getCounter('bytes')).toBe(1024);
    });

    it('tracks counters with different tags separately', () => {
      metrics.counter('http.request', { method: 'GET' });
      metrics.counter('http.request', { method: 'POST' });
      metrics.counter('http.request', { method: 'GET' });
      expect(metrics.getCounter('http.request', { method: 'GET' })).toBe(2);
      expect(metrics.getCounter('http.request', { method: 'POST' })).toBe(1);
      expect(metrics.getCounter('http.request')).toBe(3); // total
    });

    it('returns 0 for unknown counter', () => {
      expect(metrics.getCounter('nonexistent')).toBe(0);
    });
  });

  describe('gauges', () => {
    it('sets gauge value', () => {
      metrics.gauge('connections', 5);
      expect(metrics.getGauge('connections')).toBe(5);
    });

    it('overwrites gauge value', () => {
      metrics.gauge('connections', 5);
      metrics.gauge('connections', 3);
      expect(metrics.getGauge('connections')).toBe(3);
    });

    it('tracks gauges with tags', () => {
      metrics.gauge('memory', 100, { region: 'us' });
      metrics.gauge('memory', 200, { region: 'eu' });
      expect(metrics.getGauge('memory', { region: 'us' })).toBe(100);
      expect(metrics.getGauge('memory', { region: 'eu' })).toBe(200);
    });

    it('returns undefined for unknown gauge', () => {
      expect(metrics.getGauge('nonexistent')).toBeUndefined();
    });
  });

  describe('histograms', () => {
    it('records histogram values', () => {
      metrics.histogram('latency', 10);
      metrics.histogram('latency', 20);
      metrics.histogram('latency', 30);
      expect(metrics.getHistogramValues('latency')).toEqual([10, 20, 30]);
    });

    it('tracks histograms with tags', () => {
      metrics.histogram('latency', 10, { path: '/api' });
      metrics.histogram('latency', 50, { path: '/health' });
      expect(metrics.getHistogramValues('latency', { path: '/api' })).toEqual([10]);
      expect(metrics.getHistogramValues('latency', { path: '/health' })).toEqual([50]);
    });

    it('returns empty array for unknown histogram', () => {
      expect(metrics.getHistogramValues('nonexistent')).toEqual([]);
    });
  });

  describe('snapshot', () => {
    it('returns complete snapshot', () => {
      metrics.counter('c1');
      metrics.gauge('g1', 42);
      metrics.histogram('h1', 10);

      const snap = metrics.getSnapshot();
      expect(snap.counters).toHaveProperty('c1');
      expect(snap.gauges).toHaveProperty('g1');
      expect(snap.histograms).toHaveProperty('h1');
      expect(snap.collectedAt).toBeDefined();
    });

    it('returns empty snapshot when reset', () => {
      metrics.counter('c1');
      metrics.reset();
      const snap = metrics.getSnapshot();
      expect(Object.keys(snap.counters)).toHaveLength(0);
    });
  });

  describe('adapters', () => {
    it('notifies adapters on counter', () => {
      const calls: string[] = [];
      const adapter: MetricsAdapter = {
        onCounter: (name) => calls.push(`counter:${name}`),
        onGauge: (name) => calls.push(`gauge:${name}`),
        onHistogram: (name) => calls.push(`histogram:${name}`),
      };
      metrics.registerAdapter(adapter);
      metrics.counter('c');
      metrics.gauge('g', 1);
      metrics.histogram('h', 1);
      expect(calls).toEqual(['counter:c', 'gauge:g', 'histogram:h']);
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.counter('c');
      metrics.gauge('g', 1);
      metrics.histogram('h', 1);
      metrics.reset();
      expect(metrics.getCounter('c')).toBe(0);
      expect(metrics.getGauge('g')).toBeUndefined();
      expect(metrics.getHistogramValues('h')).toEqual([]);
    });
  });
});
