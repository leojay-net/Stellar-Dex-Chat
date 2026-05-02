import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveDraft, getDraft, clearDraft, clearExpiredDrafts } from './draftUtils';

describe('draftUtils', () => {
  const sessionId = 'test-session';
  const content = 'Test draft content';

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(localStorage, 'setItem');
    vi.spyOn(localStorage, 'getItem');
    vi.spyOn(localStorage, 'removeItem');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should save a draft to localStorage', () => {
    saveDraft(sessionId, content);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      `chat_draft_${sessionId}`,
      expect.stringContaining(content)
    );
  });

  it('should retrieve a saved draft', () => {
    saveDraft(sessionId, content);
    const retrieved = getDraft(sessionId);
    expect(retrieved).toBe(content);
  });

  it('should return null if no draft exists', () => {
    const retrieved = getDraft('non-existent');
    expect(retrieved).toBeNull();
  });

  it('should clear a specific draft', () => {
    saveDraft(sessionId, content);
    clearDraft(sessionId);
    expect(getDraft(sessionId)).toBeNull();
  });

  it('should expire a draft older than TTL', () => {
    const ttl = 60; // 60 seconds
    saveDraft(sessionId, content);
    
    // Advance time by 61 seconds
    vi.advanceTimersByTime(61000);
    
    const retrieved = getDraft(sessionId, ttl);
    expect(retrieved).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith(`chat_draft_${sessionId}`);
  });

  it('should not expire a draft within TTL', () => {
    const ttl = 60; // 60 seconds
    saveDraft(sessionId, content);
    
    // Advance time by 30 seconds
    vi.advanceTimersByTime(30000);
    
    const retrieved = getDraft(sessionId, ttl);
    expect(retrieved).toBe(content);
  });

  it('should clear all expired drafts', () => {
    const ttl = 60;
    saveDraft('session1', 'draft1');
    vi.advanceTimersByTime(30000);
    saveDraft('session2', 'draft2');
    vi.advanceTimersByTime(31000); // Wait 61s from draft1, 31s from draft2
    
    clearExpiredDrafts(ttl);
    
    expect(getDraft('session1')).toBeNull();
    expect(getDraft('session2')).toBe('draft2');
  });
});
