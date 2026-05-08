import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('networkQueue Memory Leak Regression', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).__networkQueueListenerAdded;
  });

  it('adds the online event listener only once even when module is evaluated multiple times', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    
    // Evaluate the module first time
    await import('./networkQueue');
    
    expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
    const callCountAfterFirst = addEventListenerSpy.mock.calls.filter(c => c[0] === 'online').length;
    expect(callCountAfterFirst).toBe(1);

    // Simulate HMR / re-evaluation
    vi.resetModules();
    await import('./networkQueue');

    const callCountAfterSecond = addEventListenerSpy.mock.calls.filter(c => c[0] === 'online').length;
    // Should still be 1 because the flag prevents duplicate listeners
    expect(callCountAfterSecond).toBe(1);
    
    addEventListenerSpy.mockRestore();
  });
});
