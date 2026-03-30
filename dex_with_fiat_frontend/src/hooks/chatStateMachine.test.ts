import { TransactionData } from '@/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    ChatEvent,
    ChatGuards,
    ChatMachineContext,
    ChatState,
    createChatStateMachine,
} from './chatStateMachine';

describe('ChatStateMachine', () => {
  let machine = createChatStateMachine();

  beforeEach(() => {
    machine = createChatStateMachine();
  });

  describe('Initialization', () => {
    it('should start in UNINITIALIZED state', () => {
      const state = machine.getState();
      expect(state.state).toBe(ChatState.UNINITIALIZED);
    });

    it('should transition from UNINITIALIZED to INITIALIZED on INITIALIZE_SESSION', () => {
      const result = machine.transition(ChatEvent.INITIALIZE_SESSION);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
    });

    it('should reset context during initialization', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      const state = machine.getState();
      expect(state.context.messageCount).toBe(0);
      expect(state.context.hasUserCancelled).toBe(false);
      expect(state.context.pendingTransactionData).toBeNull();
    });

    it('should not allow other transitions from UNINITIALIZED', () => {
      expect(machine.transition(ChatEvent.SEND_MESSAGE)).toBe(false);
      expect(machine.transition(ChatEvent.CLEAR_CHAT)).toBe(false);
    });
  });

  describe('Message Sending Flow', () => {
    beforeEach(() => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
    });

    it('should transition from INITIALIZED to SENDING_MESSAGE on SEND_MESSAGE', () => {
      const result = machine.transition(ChatEvent.SEND_MESSAGE);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);
    });

    it('should transition from SENDING_MESSAGE to ANALYZING on ANALYSIS_COMPLETE', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      const result = machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.ANALYZING);
    });

    it('should transition from ANALYZING to AWAITING_USER_INPUT when no clarification needed', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      const result = machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);
    });
  });

  describe('Clarification Flow', () => {
    beforeEach(() => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
    });

    it('should transition to AWAITING_CLARIFICATION when clarification is needed', () => {
      machine.updateContext({ needsClarification: true });
      const result = machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.AWAITING_CLARIFICATION);
    });

    it('should fail to transition to AWAITING_CLARIFICATION when clarification is not needed', () => {
      machine.updateContext({ needsClarification: false });
      const result = machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      expect(result).toBe(false);
    });

    it('should transition from AWAITING_CLARIFICATION back to SENDING_MESSAGE on RECEIVE_CLARIFICATION', () => {
      machine.updateContext({ needsClarification: true });
      machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      const result = machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);
    });

    it('should allow cancellation from AWAITING_CLARIFICATION', () => {
      machine.updateContext({ needsClarification: true });
      machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      const result = machine.transition(ChatEvent.CANCEL_FLOW);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.CANCELLED);
      expect(machine.getState().context.hasUserCancelled).toBe(true);
    });
  });

  describe('Transaction Flow', () => {
    beforeEach(() => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
    });

    it('should not transition to READY_FOR_TRANSACTION without transaction data', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      const result = machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      expect(result).toBe(false);
    });

    it('should transition to READY_FOR_TRANSACTION with sufficient data', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({ pendingTransactionData: transactionData });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      const result = machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.READY_FOR_TRANSACTION);
    });

    it('should fail to trigger transaction when user has cancelled', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({
        pendingTransactionData: transactionData,
        hasUserCancelled: true,
      });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      const result = machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      expect(result).toBe(false);
    });

    it('should transition from READY_FOR_TRANSACTION to TRANSACTION_TRIGGERED on TRANSACTION_INITIATED', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({ pendingTransactionData: transactionData });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      const result = machine.transition(ChatEvent.TRANSACTION_INITIATED);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.TRANSACTION_TRIGGERED);
    });

    it('should transition from TRANSACTION_TRIGGERED back to AWAITING_USER_INPUT on TRANSACTION_COMPLETED', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({ pendingTransactionData: transactionData });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      machine.transition(ChatEvent.TRANSACTION_INITIATED);
      const result = machine.transition(ChatEvent.TRANSACTION_COMPLETED);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);
    });

    it('should allow sending new message from READY_FOR_TRANSACTION', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({ pendingTransactionData: transactionData });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      const result = machine.transition(ChatEvent.SEND_MESSAGE);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);
    });
  });

  describe('Cancellation and Reset', () => {
    beforeEach(() => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
    });

    it('should transition to CANCELLED state on CANCEL_FLOW', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.updateContext({ needsClarification: true });
      machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      const result = machine.transition(ChatEvent.CANCEL_FLOW);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.CANCELLED);
    });

    it('should set hasUserCancelled flag when cancelling', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.updateContext({ needsClarification: true });
      machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      machine.transition(ChatEvent.CANCEL_FLOW);
      expect(machine.getState().context.hasUserCancelled).toBe(true);
    });

    it('should transition from CANCELLED back to INITIALIZED on RESET_FLOW', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.updateContext({ needsClarification: true });
      machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      machine.transition(ChatEvent.CANCEL_FLOW);
      const result = machine.transition(ChatEvent.RESET_FLOW);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
      expect(machine.getState().context.hasUserCancelled).toBe(false);
    });

    it('should clear transaction data when cancelling', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({ pendingTransactionData: transactionData });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      machine.transition(ChatEvent.CANCEL_FLOW);
      expect(machine.getState().context.pendingTransactionData).toBeNull();
    });

    it('should clear transactions on CLEAR_CHAT from AWAITING_USER_INPUT', () => {
      const transactionData: TransactionData = {
        tokenIn: 'XLM',
        amountIn: 100,
      };
      machine.updateContext({ pendingTransactionData: transactionData });
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE); // Go to AWAITING_USER_INPUT
      const result = machine.transition(ChatEvent.CLEAR_CHAT);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
      expect(machine.getState().context.pendingTransactionData).toBeNull();
      expect(machine.getState().context.messageCount).toBe(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
    });

    it('should transition to ERROR state on ENCOUNTER_ERROR', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      const result = machine.transition(ChatEvent.ENCOUNTER_ERROR);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.ERROR);
    });

    it('should set error message when encountering error', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.updateContext({ errorMessage: 'Network timeout' });
      machine.transition(ChatEvent.ENCOUNTER_ERROR);
      expect(machine.getState().context.errorMessage).toBe('Network timeout');
    });

    it('should recover from ERROR on RETRY_FROM_ERROR', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.ENCOUNTER_ERROR);
      const result = machine.transition(ChatEvent.RETRY_FROM_ERROR);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);
    });

    it('should clear error on RESET_FLOW from ERROR', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.updateContext({ errorMessage: 'Network timeout' });
      machine.transition(ChatEvent.ENCOUNTER_ERROR);
      machine.transition(ChatEvent.RESET_FLOW);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
      expect(machine.getState().context.errorMessage).toBeNull();
    });

    it('should allow CLEAR_CHAT from ERROR state', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.ENCOUNTER_ERROR);
      const result = machine.transition(ChatEvent.CLEAR_CHAT);
      expect(result).toBe(true);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
    });
  });

  describe('Required acceptance paths', () => {
    beforeEach(() => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
    });

    it('idle -> sending -> success -> idle', () => {
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
      machine.transition(ChatEvent.SEND_MESSAGE);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(machine.getState().state).toBe(ChatState.ANALYZING);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);
      // idle in this machine is represented by awaiting user input after success
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);
    });

    it('idle -> sending -> error -> idle', () => {
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
      machine.transition(ChatEvent.SEND_MESSAGE);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(machine.transition(ChatEvent.ENCOUNTER_ERROR)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.ERROR);
      machine.transition(ChatEvent.RESET_FLOW);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
    });

    it('error -> retrying -> sending -> success', () => {
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.ENCOUNTER_ERROR);
      expect(machine.getState().state).toBe(ChatState.ERROR);
      machine.transition(ChatEvent.RETRY_FROM_ERROR);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);

      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(machine.getState().state).toBe(ChatState.ANALYZING);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);
    });
  });

  describe('Guards and Conditions', () => {
    describe('hasTransactionData guard', () => {
      it('should return false with null transaction data', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: null,
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.hasTransactionData(context)).toBe(false);
      });

      it('should return true with tokenIn', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: { tokenIn: 'XLM' },
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.hasTransactionData(context)).toBe(true);
      });

      it('should return true with amountIn', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: { amountIn: 100 },
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.hasTransactionData(context)).toBe(true);
      });

      it('should return true with fiatAmount', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: { fiatAmount: 50 },
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.hasTransactionData(context)).toBe(true);
      });
    });

    describe('hasReachedMessageThreshold guard', () => {
      it('should return false with fewer than 3 messages', () => {
        const context: ChatMachineContext = {
          messageCount: 2,
          hasUserCancelled: false,
          pendingTransactionData: null,
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.hasReachedMessageThreshold(context)).toBe(false);
      });

      it('should return true with 3 or more messages', () => {
        const context: ChatMachineContext = {
          messageCount: 3,
          hasUserCancelled: false,
          pendingTransactionData: null,
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.hasReachedMessageThreshold(context)).toBe(true);
      });
    });

    describe('shouldProceed guard', () => {
      it('should return true when not cancelled', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: null,
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.shouldProceed(context)).toBe(true);
      });

      it('should return false when cancelled', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: true,
          pendingTransactionData: null,
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.shouldProceed(context)).toBe(false);
      });
    });

    describe('canTriggerTransaction guard', () => {
      it('should return false without transaction data', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: null,
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.canTriggerTransaction(context)).toBe(false);
      });

      it('should return false when cancelled', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: true,
          pendingTransactionData: { tokenIn: 'XLM' },
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.canTriggerTransaction(context)).toBe(false);
      });

      it('should return true with data and not cancelled', () => {
        const context: ChatMachineContext = {
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: { tokenIn: 'XLM', amountIn: 100 },
          needsClarification: false,
          clarificationQuestion: null,
          errorMessage: null,
          lastEventTime: Date.now(),
          previousState: null,
        };
        expect(ChatGuards.canTriggerTransaction(context)).toBe(true);
      });
    });
  });

  describe('State Machine Subscriptions', () => {
    it('should notify listeners on state change', () => {
      let notifiedState: ChatState | null = null;
      const unsubscribe = machine.subscribe((state) => {
        notifiedState = state;
      });

      machine.transition(ChatEvent.INITIALIZE_SESSION);
      expect(notifiedState).toBe(ChatState.INITIALIZED);

      unsubscribe();
    });

    it('should allow unsubscribing from state changes', () => {
      let notificationCount = 0;
      const unsubscribe = machine.subscribe(() => {
        notificationCount++;
      });

      machine.transition(ChatEvent.INITIALIZE_SESSION);
      expect(notificationCount).toBe(1);

      unsubscribe();
      machine.transition(ChatEvent.SEND_MESSAGE);
      expect(notificationCount).toBe(1);
    });
  });

  describe('Valid Transitions', () => {
    it('should list valid transitions from INITIALIZED', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      const validTransitions = machine.getValidTransitions();
      expect(validTransitions).toContain(ChatEvent.SEND_MESSAGE);
      expect(validTransitions).toContain(ChatEvent.LOAD_SESSION);
      expect(validTransitions).toContain(ChatEvent.CLEAR_CHAT);
    });

    it('should list valid transitions from SENDING_MESSAGE', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      machine.transition(ChatEvent.SEND_MESSAGE);
      const validTransitions = machine.getValidTransitions();
      expect(validTransitions).toContain(ChatEvent.ANALYSIS_COMPLETE);
    });

    it('should list valid transitions from AWAITING_USER_INPUT', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      const validTransitions = machine.getValidTransitions();
      expect(validTransitions).toContain(ChatEvent.SEND_MESSAGE);
      expect(validTransitions).toContain(ChatEvent.CLEAR_CHAT);
      expect(validTransitions).toContain(ChatEvent.LOAD_SESSION);
    });
  });

  describe('Transition History', () => {
    it('should record transition history', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);

      const history = machine.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history[0].from).toBe(ChatState.UNINITIALIZED);
      expect(history[0].to).toBe(ChatState.INITIALIZED);
      expect(history[0].event).toBe(ChatEvent.INITIALIZE_SESSION);
    });
  });

  describe('Context Updates', () => {
    it('should update context without changing state', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      machine.updateContext({ messageCount: 5 });
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
      expect(machine.getState().context.messageCount).toBe(5);
    });

    it('should support partial context updates', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      const transactionData: TransactionData = { tokenIn: 'XLM' };
      machine.updateContext({
        messageCount: 3,
        pendingTransactionData: transactionData,
      });
      const context = machine.getState().context;
      expect(context.messageCount).toBe(3);
      expect(context.pendingTransactionData).toEqual(transactionData);
    });
  });

  describe('Integration: Complete Happy Path', () => {
    it('should handle complete transaction flow', () => {
      // Initialize
      expect(machine.transition(ChatEvent.INITIALIZE_SESSION)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);

      // Send first message
      expect(machine.transition(ChatEvent.SEND_MESSAGE)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.SENDING_MESSAGE);

      // Analysis complete
      expect(machine.transition(ChatEvent.ANALYSIS_COMPLETE)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.ANALYZING);

      // No clarification needed, go to awaiting input
      expect(machine.transition(ChatEvent.ANALYSIS_COMPLETE)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);

      // Second message with transaction data
      expect(machine.transition(ChatEvent.SEND_MESSAGE)).toBe(true);
      machine.updateContext({
        messageCount: 2,
        pendingTransactionData: { tokenIn: 'XLM', amountIn: 100 },
      });
      expect(machine.transition(ChatEvent.ANALYSIS_COMPLETE)).toBe(true);

      // Trigger transaction
      expect(machine.transition(ChatEvent.TRIGGER_TRANSACTION)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.READY_FOR_TRANSACTION);

      // Initiate transaction
      expect(machine.transition(ChatEvent.TRANSACTION_INITIATED)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.TRANSACTION_TRIGGERED);

      // Complete transaction
      expect(machine.transition(ChatEvent.TRANSACTION_COMPLETED)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.AWAITING_USER_INPUT);
    });

    it('should handle cancellation from transaction readiness', () => {
      machine.transition(ChatEvent.INITIALIZE_SESSION);
      machine.transition(ChatEvent.SEND_MESSAGE);
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      machine.updateContext({
        pendingTransactionData: { tokenIn: 'XLM', amountIn: 100 },
      });
      machine.transition(ChatEvent.TRIGGER_TRANSACTION);

      // Cancel
      expect(machine.transition(ChatEvent.CANCEL_FLOW)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.CANCELLED);
      expect(machine.getState().context.hasUserCancelled).toBe(true);
      expect(machine.getState().context.pendingTransactionData).toBeNull();

      // Reset
      expect(machine.transition(ChatEvent.RESET_FLOW)).toBe(true);
      expect(machine.getState().state).toBe(ChatState.INITIALIZED);
    });
  });
});
