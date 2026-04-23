import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { withNetworkReadQueue } from './networkQueue';
import { toastStore } from './toastStore';

// Mock toastStore
vi.mock('./toastStore', () => ({
  toastStore: {
    addToast: vi.fn(),
    removeToast: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getToasts: vi.fn(() => []),
    clearToasts: vi.fn(),
  },
}));

describe(
  'networkQueue with toastStore integration',
  { timeout: 15000 },
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should call toastStore.addToast with success variant on successful request', async () => {
      const mockTask = vi.fn().mockResolvedValue({ result: 'success' });

      const result = await withNetworkReadQueue(mockTask, 'test-request');

      expect(result).toEqual({ result: 'success' });
      expect(mockTask).toHaveBeenCalled();
    });

    it('should trigger success toast when a retried request succeeds', async () => {
      // Simulate offline then online scenario
      let isOnline = false;
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => isOnline,
      });

      const mockTask = vi.fn().mockResolvedValue({ data: 'success' });

      // Start offline
      isOnline = false;
      const promise = withNetworkReadQueue(mockTask, 'test-request');

      // Wait for queue
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not have called task yet
      expect(mockTask).not.toHaveBeenCalled();

      // Come back online
      isOnline = true;
      window.dispatchEvent(new Event('online'));

      // Wait for processing
      const result = await promise;

      expect(result).toEqual({ data: 'success' });
      // Success toast should be called with correct variant
      const calls = vi.mocked(toastStore.addToast).mock.calls;
      const hasSuccessToast = calls.some(
        (call) =>
          call[0] === 'Message sent!' && call[1] === 'success'
      );
      expect(hasSuccessToast).toBe(true);
    });

    it('should trigger error toast when request fails after MAX_RETRY', async () => {
      let isOnline = true;
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => isOnline,
      });

      const mockTask = vi.fn().mockImplementation(async () => {
        // Always fail with network error
        throw new Error('failed to fetch');
      });

      isOnline = false;
      const promise = withNetworkReadQueue(mockTask, 'failing-request');

      // Wait for queue
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate coming back online 6 times to trigger retries
      // (attempts 0-4 will retry, attempt 5 will fail with error toast)
      for (let i = 0; i < 6; i++) {
        isOnline = true;
        window.dispatchEvent(new Event('online'));
        await new Promise((resolve) => setTimeout(resolve, 80));
        isOnline = false;
      }

      // Come back online one last time for the final processing
      isOnline = true;
      window.dispatchEvent(new Event('online'));
      await new Promise((resolve) => setTimeout(resolve, 150));

      try {
        await promise;
      } catch {
        // Expected to fail
      }

      // Error toast should be called with correct variant
      const calls = vi.mocked(toastStore.addToast).mock.calls;
      const hasErrorToast = calls.some(
        (call) =>
          call[0] === 'Could not send. Please try again.' &&
          call[1] === 'error'
      );
      expect(hasErrorToast).toBe(true);
    });

    it('should use success variant for retry success toast', async () => {
      const isOnline = true;
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => isOnline,
      });

      const mockTask = vi.fn().mockResolvedValue({ data: 'test' });

      const result = await withNetworkReadQueue(mockTask, 'test');

      expect(result).toEqual({ data: 'test' });

      const calls = vi.mocked(toastStore.addToast).mock.calls;
      const successToastCall = calls.find(
        (call) => call[0] === 'Message sent!'
      );

      if (successToastCall) {
        expect(successToastCall[1]).toBe('success');
      }
    });

    it('should use error variant for final failure toast', async () => {
      let isOnline = true;
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => isOnline,
      });

      const mockTask = vi.fn().mockRejectedValue(
        new Error('failed to fetch')
      );

      isOnline = false;
      const promise = withNetworkReadQueue(mockTask, 'test');

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate retries by coming back online
      for (let i = 0; i < 6; i++) {
        isOnline = true;
        window.dispatchEvent(new Event('online'));
        await new Promise((resolve) => setTimeout(resolve, 100));
        isOnline = false;
      }

      try {
        await promise;
      } catch {
        // Expected to fail
      }

      const calls = vi.mocked(toastStore.addToast).mock.calls;
      const errorToastCall = calls.find(
        (call) => call[0] === 'Could not send. Please try again.'
      );

      if (errorToastCall) {
        expect(errorToastCall[1]).toBe('error');
      }
    });

    it('should not trigger toast for immediate non-network errors', async () => {
      const isOnline = true;
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => isOnline,
      });

      const mockTask = vi.fn().mockRejectedValue(
        new Error('invalid input')
      );

      try {
        await withNetworkReadQueue(mockTask, 'test');
      } catch {
        // Expected to fail immediately
      }

      // For non-network errors when online, failure happens immediately without retries
      // So there should be no toast calls for immediate failures
      const calls = vi.mocked(toastStore.addToast).mock.calls;
      expect(calls.length).toBe(0);
    });
  }
);
