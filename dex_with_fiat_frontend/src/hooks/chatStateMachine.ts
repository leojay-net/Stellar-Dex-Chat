/**
 * Chat lifecycle finite-state machine definition
 * Models the complete chat flow from initialization through transaction completion
 */

import { StateMachine, StateMachineConfig } from '@/lib/stateMachine';
import { TransactionData } from '@/types';

/**
 * Chat lifecycle states
 */
export enum ChatState {
  // Initialization & Setup
  UNINITIALIZED = 'UNINITIALIZED',
  INITIALIZED = 'INITIALIZED',

  // Message Input & Processing
  AWAITING_USER_INPUT = 'AWAITING_USER_INPUT',
  SENDING_MESSAGE = 'SENDING_MESSAGE',
  ANALYZING = 'ANALYZING',

  // Transaction Flow States
  AWAITING_CLARIFICATION = 'AWAITING_CLARIFICATION',
  READY_FOR_TRANSACTION = 'READY_FOR_TRANSACTION',
  TRANSACTION_TRIGGERED = 'TRANSACTION_TRIGGERED',

  // Terminal States
  CANCELLED = 'CANCELLED',
  ERROR = 'ERROR',
}

/**
 * Events that trigger state transitions
 */
export enum ChatEvent {
  // Lifecycle
  INITIALIZE_SESSION = 'INITIALIZE_SESSION',
  CLEAR_CHAT = 'CLEAR_CHAT',
  LOAD_SESSION = 'LOAD_SESSION',

  // Message Handling
  SEND_MESSAGE = 'SEND_MESSAGE',
  ANALYSIS_COMPLETE = 'ANALYSIS_COMPLETE',
  RECEIVE_CLARIFICATION = 'RECEIVE_CLARIFICATION',

  // Transaction Flow
  TRIGGER_TRANSACTION = 'TRIGGER_TRANSACTION',
  TRANSACTION_INITIATED = 'TRANSACTION_INITIATED',
  TRANSACTION_COMPLETED = 'TRANSACTION_COMPLETED',

  // Error & Recovery
  ENCOUNTER_ERROR = 'ENCOUNTER_ERROR',
  RETRY_FROM_ERROR = 'RETRY_FROM_ERROR',
  CANCEL_FLOW = 'CANCEL_FLOW',
  RESET_FLOW = 'RESET_FLOW',
}

/**
 * Chat context required for transition guards and logic
 */
export interface ChatMachineContext {
  messageCount: number;
  hasUserCancelled: boolean;
  pendingTransactionData: TransactionData | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  errorMessage: string | null;
  lastEventTime: number;
  previousState: ChatState | null;
}

const INITIAL_CONTEXT: ChatMachineContext = {
  messageCount: 0,
  hasUserCancelled: false,
  pendingTransactionData: null,
  needsClarification: false,
  clarificationQuestion: null,
  errorMessage: null,
  lastEventTime: Date.now(),
  previousState: null,
};

/**
 * Guards for conditional transitions
 */
class ChatGuards {
  /**
   * Has enough transaction data to proceed
   */
  static hasTransactionData = (context: ChatMachineContext): boolean => {
    return (
      context.pendingTransactionData !== null &&
      (!!context.pendingTransactionData.tokenIn ||
        !!context.pendingTransactionData.amountIn ||
        !!context.pendingTransactionData.fiatAmount)
    );
  };

  /**
   * Has reached sufficient message count for auto-triggering
   */
  static hasReachedMessageThreshold = (context: ChatMachineContext): boolean => {
    return context.messageCount >= 3;
  };

  /**
   * Should proceed (not cancelled and meets conditions)
   */
  static shouldProceed = (context: ChatMachineContext): boolean => {
    return !context.hasUserCancelled;
  };

  /**
   * Has sufficient data to trigger transaction
   */
  static canTriggerTransaction = (context: ChatMachineContext): boolean => {
    return (
      ChatGuards.hasTransactionData(context) &&
      ChatGuards.shouldProceed(context)
    );
  };

  /**
   * Can recover from error (has original payload)
   */
  static canRecoverFromError = (context: ChatMachineContext): boolean => {
    return context.errorMessage !== null;
  };
}

/**
 * Create and configure the chat state machine
 */
export function createChatStateMachine(): StateMachine<ChatState, ChatEvent, ChatMachineContext> {
  const config: StateMachineConfig<ChatState, ChatEvent, ChatMachineContext> = {
    initial: ChatState.UNINITIALIZED,
    context: INITIAL_CONTEXT,
    states: {
      [ChatState.UNINITIALIZED]: {
        [ChatEvent.INITIALIZE_SESSION]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.messageCount = 0;
            context.hasUserCancelled = false;
            context.pendingTransactionData = null;
            context.needsClarification = false;
            context.errorMessage = null;
          },
        },
      },

      [ChatState.INITIALIZED]: {
        [ChatEvent.SEND_MESSAGE]: ChatState.SENDING_MESSAGE,
        [ChatEvent.LOAD_SESSION]: ChatState.INITIALIZED,
        [ChatEvent.CLEAR_CHAT]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.messageCount = 0;
            context.hasUserCancelled = false;
            context.pendingTransactionData = null;
            context.needsClarification = false;
            context.errorMessage = null;
          },
        },
      },

      [ChatState.SENDING_MESSAGE]: {
        [ChatEvent.ANALYSIS_COMPLETE]: ChatState.ANALYZING,
        [ChatEvent.CANCEL_FLOW]: {
          target: ChatState.CANCELLED,
          action: (context) => {
            context.hasUserCancelled = true;
            context.pendingTransactionData = null;
          },
        },
        [ChatEvent.ENCOUNTER_ERROR]: ChatState.ERROR,
      },

      [ChatState.ANALYZING]: {
        // If clarification is needed, wait for user response
        [ChatEvent.RECEIVE_CLARIFICATION]: {
          target: ChatState.AWAITING_CLARIFICATION,
          guard: (context) => context.needsClarification,
        },
        // If ready for transaction, go to ready state
        [ChatEvent.TRIGGER_TRANSACTION]: {
          target: ChatState.READY_FOR_TRANSACTION,
          guard: ChatGuards.canTriggerTransaction,
        },
        // Otherwise, go back to awaiting input
        [ChatEvent.ANALYSIS_COMPLETE]: ChatState.AWAITING_USER_INPUT,
        [ChatEvent.ENCOUNTER_ERROR]: ChatState.ERROR,
        [ChatEvent.CANCEL_FLOW]: {
          target: ChatState.CANCELLED,
          action: (context) => {
            context.hasUserCancelled = true;
            context.pendingTransactionData = null;
          },
        },
      },

      [ChatState.AWAITING_CLARIFICATION]: {
        [ChatEvent.RECEIVE_CLARIFICATION]: ChatState.SENDING_MESSAGE,
        [ChatEvent.CANCEL_FLOW]: {
          target: ChatState.CANCELLED,
          action: (context) => {
            context.hasUserCancelled = true;
          },
        },
      },

      [ChatState.READY_FOR_TRANSACTION]: {
        [ChatEvent.TRANSACTION_INITIATED]: ChatState.TRANSACTION_TRIGGERED,
        [ChatEvent.CANCEL_FLOW]: {
          target: ChatState.CANCELLED,
          action: (context) => {
            context.hasUserCancelled = true;
            context.pendingTransactionData = null;
          },
        },
        [ChatEvent.SEND_MESSAGE]: ChatState.SENDING_MESSAGE,
      },

      [ChatState.TRANSACTION_TRIGGERED]: {
        [ChatEvent.TRANSACTION_COMPLETED]: ChatState.AWAITING_USER_INPUT,
        [ChatEvent.CANCEL_FLOW]: {
          target: ChatState.CANCELLED,
          action: (context) => {
            context.hasUserCancelled = true;
          },
        },
      },

      [ChatState.AWAITING_USER_INPUT]: {
        [ChatEvent.SEND_MESSAGE]: ChatState.SENDING_MESSAGE,
        [ChatEvent.CLEAR_CHAT]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.messageCount = 0;
            context.hasUserCancelled = false;
            context.pendingTransactionData = null;
          },
        },
        [ChatEvent.LOAD_SESSION]: ChatState.INITIALIZED,
      },

      [ChatState.CANCELLED]: {
        [ChatEvent.RESET_FLOW]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.hasUserCancelled = false;
            context.pendingTransactionData = null;
            context.needsClarification = false;
            context.messageCount = 0;
          },
        },
        [ChatEvent.SEND_MESSAGE]: ChatState.SENDING_MESSAGE,
        [ChatEvent.CLEAR_CHAT]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.messageCount = 0;
            context.hasUserCancelled = false;
            context.pendingTransactionData = null;
          },
        },
      },

      [ChatState.ERROR]: {
        [ChatEvent.RETRY_FROM_ERROR]: ChatState.SENDING_MESSAGE,
        [ChatEvent.RESET_FLOW]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.errorMessage = null;
            context.messageCount = 0;
            context.pendingTransactionData = null;
          },
        },
        [ChatEvent.CLEAR_CHAT]: {
          target: ChatState.INITIALIZED,
          action: (context) => {
            context.errorMessage = null;
            context.messageCount = 0;
          },
        },
      },
    },
  };

  return new StateMachine<ChatState, ChatEvent, ChatMachineContext>(config);
}

export { ChatGuards };
