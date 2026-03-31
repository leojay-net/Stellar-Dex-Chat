/**
 * Performance Benchmarking Utilities
 * Measures rendering performance, memory usage, and other metrics
 */

export interface PerformanceMetrics {
  renderTime: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  cumulativeLayoutShift?: number;
  memoryUsage?: number;
  fps?: number;
}

export interface BenchmarkResult {
  name: string;
  metrics: PerformanceMetrics;
  timestamp: number;
}

export class PerformanceBench {
  private static benchmarks: BenchmarkResult[] = [];
  private static frameCount = 0;
  private static lastFrameTime = 0;
  private static rafId: number | null = null;

  /**
   * Measure rendering time for a function
   */
  static measureRender(
    fn: () => void,
    label: string = 'Render',
  ): PerformanceMetrics {
    const startTime = performance.now();

    fn();

    const endTime = performance.now();
    const renderTime = endTime - startTime;

    const metrics: PerformanceMetrics = {
      renderTime,
      memoryUsage: this.getMemoryUsage(),
    };

    this.benchmarks.push({
      name: label,
      metrics,
      timestamp: Date.now(),
    });

    return metrics;
  }

  /**
   * Measure Core Web Vitals
   */
  static measureWebVitals(): Partial<PerformanceMetrics> {
    const metrics: Partial<PerformanceMetrics> = {};

    if (typeof window === 'undefined') return metrics;

    // Get navigation timing
    const navTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navTiming) {
      metrics.renderTime = navTiming.loadEventEnd - navTiming.fetchStart;
    }

    // Get FCP
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    if (fcp) {
      metrics.firstContentfulPaint = fcp.startTime;
    }

    // Get LCP
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    if (lcpEntries.length > 0) {
      metrics.largestContentfulPaint = lcpEntries[lcpEntries.length - 1].startTime;
    }

    // Get CLS - requires PerformanceObserver
    metrics.memoryUsage = this.getMemoryUsage();

    return metrics;
  }

  /**
   * Get memory usage (if available)
   */
  private static getMemoryUsage(): number | undefined {
    if (typeof performance === 'object' && 'memory' in performance) {
      const perfAny = performance as Record<string, unknown>;
      const memoryData = perfAny.memory as Record<string, unknown>;
      if (memoryData && 'usedJSHeapSize' in memoryData) {
        return memoryData.usedJSHeapSize as number;
      }
    }
    return undefined;
  }

  /**
   * Measure frames per second
   */
  private static measureFPS() {
    // Only measure FPS if requestAnimationFrame is available (browser environment)
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame((currentTime) => {
        const deltaTime = currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;
        this.frameCount++;

        if (deltaTime >= 1000) {
          // Update FPS every second
          this.measureFPS();
        } else {
          this.measureFPS();
        }
      });
    }
  }

  /**
   * Get all benchmarks
   */
  static getBenchmarks(): BenchmarkResult[] {
    return [...this.benchmarks];
  }

  /**
   * Clear benchmarks
   */
  static clear(): void {
    this.benchmarks = [];
  }

  /**
   * Format metrics for logging
   */
  static formatMetrics(metrics: PerformanceMetrics): string {
    let output = `\n📊 Performance Metrics:\n`;
    output += `  • Render Time: ${metrics.renderTime.toFixed(2)}ms\n`;

    if (metrics.firstContentfulPaint) {
      output += `  • FCP: ${metrics.firstContentfulPaint.toFixed(2)}ms\n`;
    }

    if (metrics.largestContentfulPaint) {
      output += `  • LCP: ${metrics.largestContentfulPaint.toFixed(2)}ms\n`;
    }

    if (metrics.memoryUsage) {
      const memoryMB = (metrics.memoryUsage / 1024 / 1024).toFixed(2);
      output += `  • Memory: ${memoryMB}MB\n`;
    }

    return output;
  }

  /**
   * Compare two benchmarks
   */
  static compare(before: PerformanceMetrics, after: PerformanceMetrics): string {
    const renderImprovement =
      ((before.renderTime - after.renderTime) / before.renderTime) * 100;
    const memoryImprovement = before.memoryUsage && after.memoryUsage 
      ? ((before.memoryUsage - after.memoryUsage) / before.memoryUsage) * 100 
      : null;

    let output = `\n📈 Performance Comparison:\n`;
    output += `  • Render Time: ${before.renderTime.toFixed(2)}ms → ${after.renderTime.toFixed(2)}ms (${renderImprovement > 0 ? '+' : ''}${renderImprovement.toFixed(1)}%)\n`;

    if (memoryImprovement !== null) {
      output += `  • Memory: ${(before.memoryUsage! / 1024 / 1024).toFixed(2)}MB → ${(after.memoryUsage! / 1024 / 1024).toFixed(2)}MB (${memoryImprovement > 0 ? '+' : ''}${memoryImprovement.toFixed(1)}%)\n`;
    }

    return output;
  }
}

export default PerformanceBench;
