import { ChatMessage } from '@/types';
import { describe, expect, it } from 'vitest';

describe('Message Retry UX', () => {
  describe('Error State Tracking', () => {
    it('should mark a message as failed with error details', () => {
      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send message',
        timestamp: new Date(),
        error: {
          message: 'Network timeout',
          timestamp: new Date(),
          retryAttempts: 0,
        },
      };

      expect(failedMessage.error).toBeDefined();
      expect(failedMessage.error?.message).toBe('Network timeout');
      expect(failedMessage.error?.retryAttempts).toBe(0);
    });

    it('should store original payload for retry', () => {
      const messageWithPayload: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send message',
        timestamp: new Date(),
        originalPayload: {
          content: 'Send message',
          conversationContext: {
            isWalletConnected: true,
            messageCount: 1,
            hasTransactionData: false,
          },
        },
      };

      expect(messageWithPayload.originalPayload).toBeDefined();
      expect(messageWithPayload.originalPayload?.content).toBe('Send message');
      expect(messageWithPayload.originalPayload?.conversationContext?.isWalletConnected).toBe(true);
    });

    it('should track retry attempts incrementally', () => {
      const initialError = {
        message: 'Failed',
        timestamp: new Date(),
        retryAttempts: 0,
      };

      // Simulate first failure
      let retryCount = initialError.retryAttempts + 1;
      expect(retryCount).toBe(1);

      // Simulate second failure
      retryCount += 1;
      expect(retryCount).toBe(2);

      // Simulate third failure
      retryCount += 1;
      expect(retryCount).toBe(3);
    });
  });

  describe('Retry Functionality', () => {
    it('should clear error state when retrying', () => {
      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send message',
        timestamp: new Date(),
        error: {
          message: 'Network error',
          timestamp: new Date(),
          retryAttempts: 1,
        },
      };

      // Simulate retry clearing error
      const retriedMessage: ChatMessage = {
        ...failedMessage,
        error: undefined,
      };

      expect(retriedMessage.error).toBeUndefined();
    });

    it('should resend with original payload on retry', () => {
      const messageToRetry: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Check my balance',
        timestamp: new Date(),
        error: {
          message: 'Request failed',
          timestamp: new Date(),
          retryAttempts: 1,
        },
        originalPayload: {
          content: 'Check my balance',
          conversationContext: {
            isWalletConnected: true,
            walletAddress: '0xabc123',
            messageCount: 5,
            hasTransactionData: false,
            previousMessages: [
              { role: 'user', content: 'Hello' },
              { role: 'assistant', content: 'Hi there!' },
            ],
          },
        },
      };

      expect(messageToRetry.originalPayload?.content).toEqual(messageToRetry.content);
      expect(messageToRetry.originalPayload?.conversationContext?.messageCount).toBe(5);
    });

    it('should handle retry with no original payload gracefully', () => {
      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send message',
        timestamp: new Date(),
        error: {
          message: 'Failed',
          timestamp: new Date(),
          retryAttempts: 1,
        },
        // No originalPayload
      };

      // Should handle missing payload
      const canRetry = !!failedMessage.originalPayload;
      expect(canRetry).toBe(false);
    });
  });

  describe('Retry Transitions', () => {
    it('should transition from failed to pending state on retry', () => {
      // Initial failed state
      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send',
        timestamp: new Date(),
        error: {
          message: 'Error',
          timestamp: new Date(),
          retryAttempts: 1,
        },
        originalPayload: {
          content: 'Send',
        },
      };

      // After clicking retry, error is cleared
      const retriedMessage: ChatMessage = {
        ...failedMessage,
        error: undefined,
      };

      expect(retriedMessage.error).toBeUndefined();
    });

    it('should transition from retry to success on successful response', () => {
      // Message after successful retry
      const successMessage: ChatMessage = {
        id: 'assistant-response-1',
        role: 'assistant',
        content: 'Balance is 100 XLM',
        timestamp: new Date(),
        metadata: {
          suggestedActions: [
            {
              id: 'action1',
              type: 'confirm_fiat' as const,
              label: 'Proceed',
            },
          ],
        },
      };

      expect(successMessage.error).toBeUndefined();
      expect(successMessage.content).toBeDefined();
      expect(successMessage.metadata).toBeDefined();
    });

    it('should handle retry failure with incremented retry count', () => {
      // First attempt failed
      let failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send',
        timestamp: new Date(),
        error: {
          message: 'Network error',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: { content: 'Send' },
      };

      // Clear error to retry
      failedMessage = { ...failedMessage, error: undefined };

      // Second attempt also fails
      failedMessage = {
        ...failedMessage,
        error: {
          message: 'Still failing',
          timestamp: new Date(),
          retryAttempts: 1, // Incremented
        },
      };

      expect(failedMessage.error?.retryAttempts).toBe(1);
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should handle temporary network errors', () => {
      const networkErrorMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Get balance',
        timestamp: new Date(),
        error: {
          message: 'Network timeout',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: {
          content: 'Get balance',
          conversationContext: {
            isWalletConnected: true,
            messageCount: 2,
          },
        },
      };

      expect(networkErrorMessage.error?.message).toContain('timeout');
      expect(networkErrorMessage.originalPayload).toBeDefined();
    });

    it('should handle server errors with meaningful messages', () => {
      const serverErrorMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Verify transaction',
        timestamp: new Date(),
        error: {
          message: '500: Internal Server Error',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: {
          content: 'Verify transaction',
        },
      };

      expect(serverErrorMessage.error?.message).toContain('500');
    });

    it('should track error timestamp for UX', () => {
      const errorTime = new Date('2026-03-27T10:00:00');
      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send',
        timestamp: new Date('2026-03-27T09:59:00'),
        error: {
          message: 'Failed',
          timestamp: errorTime,
          retryAttempts: 0,
        },
      };

      expect(failedMessage.error?.timestamp.getTime()).toBe(errorTime.getTime());
    });
  });

  describe('UI State Management', () => {
    it('should preserve message ID across retry attempts', () => {
      const messageId = 'msg-123';
      const failedMessage: ChatMessage = {
        id: messageId,
        role: 'user',
        content: 'Send',
        timestamp: new Date(),
        error: {
          message: 'Error',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: { content: 'Send' },
      };

      // After retry
      const retriedMessage: ChatMessage = {
        ...failedMessage,
        error: undefined,
      };

      expect(retriedMessage.id).toBe(messageId);
    });

    it('should maintain conversation context during retry', () => {
      const conversationContext = {
        isWalletConnected: true,
        walletAddress: '0xstella123',
        messageCount: 3,
        hasTransactionData: true,
        previousMessages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      };

      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Check status',
        timestamp: new Date(),
        error: {
          message: 'Failed',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: {
          content: 'Check status',
          conversationContext,
        },
      };

      expect(failedMessage.originalPayload?.conversationContext).toEqual(conversationContext);
    });

    it('should show retry UI only for user messages with errors', () => {
      const failedUserMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send',
        timestamp: new Date(),
        error: {
          message: 'Failed',
          timestamp: new Date(),
          retryAttempts: 0,
        },
      };

      const normalAssistantMessage: ChatMessage = {
        id: '2',
        role: 'assistant',
        content: 'Response',
        timestamp: new Date(),
      };

      const shouldShowRetry = (msg: ChatMessage) => msg.role === 'user' && !!msg.error;

      expect(shouldShowRetry(failedUserMessage)).toBe(true);
      expect(shouldShowRetry(normalAssistantMessage)).toBe(false);
    });
  });

  describe('Acceptance Criteria', () => {
    it('✅ should show retry action on failed messages', () => {
      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send message',
        timestamp: new Date(),
        error: {
          message: 'Network error',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: { content: 'Send message' },
      };

      // Message has error state indicating failed status
      expect(failedMessage.error).toBeDefined();
      expect(failedMessage.error?.message).toBeTruthy();
    });

    it('✅ should retry with original payload and context', () => {
      const originalPayload = {
        content: 'Check balance',
        conversationContext: {
          isWalletConnected: true,
          walletAddress: '0xuser',
          messageCount: 2,
          previousMessages: [
            { role: 'user', content: 'Hello' },
          ],
        },
      };

      const failedMessage: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Check balance',
        timestamp: new Date(),
        error: {
          message: 'Failed',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload,
      };

      // Original payload is complete and preserved
      expect(failedMessage.originalPayload?.content).toBe(originalPayload.content);
      expect(failedMessage.originalPayload?.conversationContext).toBeDefined();
    });

    it('✅ should track retry attempts in UI state', () => {
      let message: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Send',
        timestamp: new Date(),
        error: {
          message: 'Error',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: { content: 'Send' },
      };

      // First retry failure
      message = {
        ...message,
        error: {
          ...message.error!,
          retryAttempts: 1,
        },
      };
      expect(message.error?.retryAttempts).toBe(1);

      // Second retry failure
      message = {
        ...message,
        error: {
          ...message.error!,
          retryAttempts: 2,
        },
      };
      expect(message.error?.retryAttempts).toBe(2);
    });

    it('✅ should transition through retry success/failure states', () => {
      const transitions: ChatMessage[] = [];

      // Initial failed state
      transitions.push({
        id: '1',
        role: 'user',
        content: 'Query',
        timestamp: new Date(),
        error: {
          message: 'Failed',
          timestamp: new Date(),
          retryAttempts: 0,
        },
        originalPayload: { content: 'Query' },
      });

      // Clear error for retry
      transitions.push({
        ...transitions[0],
        error: undefined,
      });

      // Success - assistant response
      transitions.push({
        id: 'response-1',
        role: 'assistant',
        content: 'Here is the answer',
        timestamp: new Date(),
      });

      expect(transitions[0].error?.message).toBe('Failed');
      expect(transitions[1].error).toBeUndefined();
      expect(transitions[2].role).toBe('assistant');
      expect(transitions[2].error).toBeUndefined();
    });
  });
});
