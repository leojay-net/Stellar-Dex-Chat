/**
 * Performance tracking utility for measuring latency of UI renders,
 * AI responses, and Stellar transaction flows.
 */

export interface PerfMetric {
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, unknown>;
}

class PerformanceTracker {
  private metrics: PerfMetric[] = [];
  private marks: Map<string, number> = new Map();

  /** Start a timer for a named operation */
  mark(name: string) {
    this.marks.set(name, performance.now());
  }

  /** End a timer and record the metric */
  measure(name: string, metadata?: Record<string, unknown>): PerfMetric | null {
    const startTime = this.marks.get(name);
    if (startTime === undefined) {
      console.warn(`No start mark found for: ${name}`);
      return null;
    }

    const endTime = performance.now();
    const metric: PerfMetric = {
      name,
      duration: endTime - startTime,
      startTime,
      endTime,
      metadata,
    };

    this.metrics.push(metric);
    this.marks.delete(name);

    // Also log to console for immediate visibility during dev/benchmarking
    console.log(
      `[PERF] ${name}: ${metric.duration.toFixed(2)}ms`,
      metadata || '',
    );

    return metric;
  }

  getMetrics(): PerfMetric[] {
    return [...this.metrics];
  }

  clear() {
    this.metrics = [];
    this.marks.clear();
  }

  /** Format metrics as a markdown table for reporting */
  generateReport(): string {
    if (this.metrics.length === 0) return 'No performance metrics recorded.';

    let report = '## Performance Benchmark Report\n\n';
    report += '| Operation | Latency (ms) | Notes |\n';
    report += '| :--- | :--- | :--- |\n';

    this.metrics.forEach((m) => {
      const notes = m.metadata ? JSON.stringify(m.metadata) : '-';
      report += `| ${m.name} | ${m.duration.toFixed(2)} | ${notes} |\n`;
    });

    return report;
  }
}

export const perf = new PerformanceTracker();
