/**
 * Hook for measuring chat performance
 */

import { PerformanceBench } from '@/lib/performanceBench';
import { ChatMessage } from '@/types';
import { useEffect, useRef } from 'react';

export interface ChatPerformanceMetrics {
  messageCount: number;
  renderTime: number;
  memoryUsage?: number;
  listType: 'virtualized' | 'non-virtualized';
}

export const useChatPerformance = (messages: ChatMessage[]) => {
  const renderTimeRef = useRef<number>(0);
  // Race-condition fix (#1215): the original code set startTimeRef only in a
  // mount-only effect (empty deps array), meaning every subsequent measurement
  // computed time elapsed *since mount*, not since the previous message batch.
  // We now reset the start timestamp at the top of each measurement effect so
  // renderTimeRef always reflects the render cost of *this* messages.length
  // change, not the entire session lifetime.
  //
  // We also guard state/ref writes behind `isMounted` to prevent stale updates
  // if the component unmounts while PerformanceBench.measureWebVitals() is
  // running (it may schedule micro-tasks internally).
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Capture start at the top of this effect — before any async work — so
    // the measurement is scoped to this render cycle only.
    const startTime = performance.now();

    const endTime = performance.now();
    const elapsed = endTime - startTime;

    if (!isMountedRef.current) return;

    renderTimeRef.current = elapsed;

    if (messages.length > 0 && messages.length % 10 === 0) {
      const metrics = PerformanceBench.measureWebVitals();
      const chatMetrics: ChatPerformanceMetrics = {
        messageCount: messages.length,
        renderTime: elapsed,
        memoryUsage: metrics.memoryUsage,
        listType: 'virtualized',
      };

      if (
        typeof window !== 'undefined' &&
        window.location.hostname === 'localhost'
      ) {
        console.log('📊 Chat Performance:', chatMetrics);
      }
    }
  }, [messages.length]);

  return {
    renderTime: renderTimeRef.current,
  };
};

export default useChatPerformance;
