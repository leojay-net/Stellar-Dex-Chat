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
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    startTimeRef.current = performance.now();
  }, []);

  useEffect(() => {
    const endTime = performance.now();
    renderTimeRef.current = endTime - startTimeRef.current;

    if (messages.length > 0 && messages.length % 10 === 0) {
      // Log performance metrics every 10 messages
      const metrics = PerformanceBench.measureWebVitals();
      const chatMetrics: ChatPerformanceMetrics = {
        messageCount: messages.length,
        renderTime: renderTimeRef.current,
        memoryUsage: metrics.memoryUsage,
        listType: 'virtualized',
      };

      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.log('📊 Chat Performance:', chatMetrics);
      }
    }
  }, [messages.length]);

  return {
    renderTime: renderTimeRef.current,
  };
};

export default useChatPerformance;
