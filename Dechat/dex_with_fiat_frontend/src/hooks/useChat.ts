'use client';

import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { AIAssistant } from '@/lib/aiAssistant';
import { perf } from '@/lib/perf';
import {
  AIAnalysisResult,
  ChatMessage,
  GuardrailCategory,
  TransactionData,
} from '@/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatEvent,
  ChatMachineContext,
  ChatState,
  createChatStateMachine,
} from './chatStateMachine';
import { useChatHistory } from './useChatHistory';
import {
  addQueuedMessage,
  getAllQueuedMessages,
  removeQueuedMessage,
  setQueuedMessageCount,
} from '@/lib/offlineMessageQueue';

/**
 * Exported state type for backward compatibility
 */
interface ConversationState {
  messageCount: number;
  hasUserCancelled: boolean;
  pendingTransactionData: TransactionData | null;
  shouldTriggerTransaction: boolean;
  isAdmin: boolean;
  awaitingClarification: boolean;
  clarificationQuestion: string | null;
}

type QueuedSend = {
  content: string;
  optimisticUserId: string;
  pendingAssistantId: string;
  machineSnapshot: {
    state: ChatState;
    context: ChatMachineContext;
  };
};

const useChat = () => {
  const { connection } = useStellarWallet();
  const {
    createNewSession,
    updateCurrentSession,
    loadSession,
    currentSessionId,
    currentSession,
  } = useChatHistory();
  const [hasHydrated, setHasHydrated] = useState(false);

  // State machine for chat lifecycle
  const machineRef = useRef<ReturnType<typeof createChatStateMachine>>(createChatStateMachine());
  const [stateUpdateTrigger, setStateUpdateTrigger] = useState(0);

  // Additional state for admin and transaction callback
  const [isAdmin, setIsAdminState] = useState(false);
  const [onTransactionReady, setOnTransactionReady] = useState<
    ((data: TransactionData) => void) | null
  >(null);

  const getInitialSuggestedActions = useCallback(() => {
    if (connection.isConnected) {
      return [
        {
          id: 'portfolio',
          type: 'check_portfolio' as const,
          label: 'Check Portfolio',
        },
        { id: 'convert', type: 'confirm_fiat' as const, label: 'Deposit XLM' },
        { id: 'rates', type: 'market_rates' as const, label: 'Market Rates' },
        { id: 'learn', type: 'learn_more' as const, label: 'How it Works' },
      ];
    } else {
      return [
        {
          id: 'connect',
          type: 'connect_wallet' as const,
          label: 'Connect Freighter',
        },
        { id: 'convert', type: 'confirm_fiat' as const, label: 'Deposit XLM' },
        { id: 'rates', type: 'market_rates' as const, label: 'Market Rates' },
        { id: 'learn', type: 'learn_more' as const, label: 'How it Works' },
      ];
    }
  }, [connection.isConnected]);

  const initialMessage = useMemo(
    () => ({
      id: '1',
      role: 'assistant' as const,
      content: `**Welcome to your Personal USDT-to-Fiat Conversion Center!**

I'm your AI specialist for seamless XLM-to-fiat conversions on Stellar. I can help you:

**Deposit XLM** into the Stellar FiatBridge smart contract
**Get real-time XLM market rates** and conversion estimates
**Setup secure bank transfers** with industry-leading security
**Track transactions** from start to completion on Stellar Expert
**Optimize timing** for better conversion rates

${connection.isConnected
          ? `**Freighter Connected**: Ready to check your XLM portfolio and start conversions!`
          : `**Connect Freighter** to get started with personalized XLM portfolio analysis.`
        }

What would you like to do today? I'm here to make your XLM-to-fiat journey smooth and profitable!`,
      timestamp: new Date(),
      metadata: {
        suggestedActions: getInitialSuggestedActions(),
      },
    }),
    [getInitialSuggestedActions, connection.isConnected],
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const aiAssistant = useMemo(() => new AIAssistant(), []);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const transactionReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const queuedSendsRef = useRef<QueuedSend[]>([]);
  const replayingQueueRef = useRef(false);

  useEffect(() => {
    setHasHydrated(true);
    return () => {
      // Cancel any in-flight transaction-ready timer on unmount to prevent
      // calling callbacks on a dismounted component (memory leak #663).
      if (transactionReadyTimerRef.current !== null) {
        clearTimeout(transactionReadyTimerRef.current);
        transactionReadyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const appendCancelledMessage = useCallback((content: string) => {
    const uid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cancelledMessage: ChatMessage = {
      id: uid,
      role: 'assistant',
      content,
      timestamp: new Date(),
      metadata: {
        requestStatus: 'cancelled',
      },
    };
    setMessages((prev: ChatMessage[]) => [...prev, cancelledMessage]);
  }, []);

  const cancelPendingRequest = useCallback(() => {
    // Read the ref directly to avoid stale-closure on isLoading state.
    if (!activeRequestControllerRef.current) {
      return;
    }
    activeRequestControllerRef.current.abort();
    activeRequestControllerRef.current = null;
    setIsLoading(false);
    appendCancelledMessage(
      'Request cancelled. No worries - you can send a new prompt when ready.',
    );
  }, [appendCancelledMessage]);

  // Subscribe to state machine changes
  useEffect(() => {
    const unsubscribe = machineRef.current.subscribe(() => {
      setStateUpdateTrigger((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  // Initialize chat session
  useEffect(() => {
    if (!hasHydrated) return;
    const machine = machineRef.current;
    const machineState = machine.getState();

    if (machineState.state === ChatState.UNINITIALIZED) {
      if (currentSession && currentSession.messages.length > 0) {
        setMessages(currentSession.messages);
        machine.transition(ChatEvent.INITIALIZE_SESSION);
        createNewSession(currentSession.messages);
      } else if (!currentSessionId) {
        setMessages([]);
        createNewSession([]);
        machine.transition(ChatEvent.INITIALIZE_SESSION);
      }
    }
  }, [currentSession, currentSessionId, createNewSession, hasHydrated]);

  // Persist messages to session
  useEffect(() => {
    if (machineRef.current.getState().state !== ChatState.UNINITIALIZED && currentSessionId && messages.length > 0) {
      updateCurrentSession(messages);
    }
  }, [messages, currentSessionId, updateCurrentSession]);

  const isLikelyNetworkError = useCallback((error: unknown): boolean => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      return true;
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('offline') ||
        msg.includes('timed out')
      );
    }

    return false;
  }, []);

  const markMessageFailed = useCallback((pendingAssistantId: string, optimisticUserId?: string) => {
    setMessages((prev: ChatMessage[]) =>
      prev.map((m) =>
        m.id === pendingAssistantId
          ? {
<<<<<<< HEAD:dex_with_fiat_frontend/src/hooks/useChat.ts
              ...m,
              content:
                'Sorry, I encountered an error processing your request. Please try again.',
              metadata: {
                ...m.metadata,
                status: 'failed',
              },
            }
          : m.id === optimisticUserId
          ? {
              ...m,
              error: {
                message: 'Message failed to send. Please try again.',
                timestamp: new Date(),
                retryAttempts: m.error?.retryAttempts ?? 0,
              },
              metadata: {
                ...m.metadata,
                status: 'failed',
              },
            }
=======
            ...m,
            content:
              'Sorry, I encountered an error processing your request. Please try again.',
            metadata: {
              ...m.metadata,
              status: 'failed',
            },
          }
>>>>>>> origin/main:Dechat/dex_with_fiat_frontend/src/hooks/useChat.ts
          : m,
      ),
    );
  }, []);

  const analyzeAndRespond = useCallback(
    async (
      content: string,
      optimisticUserId: string,
      pendingAssistantId: string,
      machineSnapshot: QueuedSend['machineSnapshot'],
      requestController: AbortController,
    ) => {
      const machine = machineRef.current;
      const isCancellation = /cancel|stop|no thanks|nevermind|abort/i.test(
        content,
      );

      const conversationContext = {
        isWalletConnected: connection.isConnected,
        walletAddress: connection.address,
        previousMessages: messagesRef.current
          .slice(-3)
          .map((m: ChatMessage) => ({ role: m.role, content: m.content })),
        messageCount: machineSnapshot.context.messageCount,
        hasTransactionData: !!machineSnapshot.context.pendingTransactionData,
      };

      perf.mark('AI: Response');
      const abortPromise = new Promise<never>((_, reject) => {
        requestController.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Request aborted', 'AbortError')),
          { once: true },
        );
      });

      const analysis = await Promise.race([
        aiAssistant.analyzeUserMessage(content, conversationContext),
        abortPromise,
      ]);
      perf.measure('AI: Response');

      // Update context with new message count
      const newMessageCount = machineSnapshot.context.messageCount + 1;
      machine.updateContext({ messageCount: newMessageCount });

      // Handle cancellation
      if (isCancellation) {
        machine.transition(ChatEvent.CANCEL_FLOW);
      }

      // Extract and accumulate transaction data
      let pendingTransactionData: TransactionData | null =
        machineSnapshot.context.pendingTransactionData;
      if (analysis.intent === 'fiat_conversion' && analysis.extractedData) {
        pendingTransactionData = {
          type: 'fiat_conversion',
          ...pendingTransactionData,
          ...analysis.extractedData,
        } as TransactionData;
      }

      // Check if we have minimal transaction data
      const hasMinimalTransactionData =
        !!(pendingTransactionData &&
          (pendingTransactionData.tokenIn ||
            pendingTransactionData.amountIn ||
            pendingTransactionData.fiatAmount));

      // Determine if clarification is needed
      const needsClarification =
        analysis.intent === 'fiat_conversion' &&
        analysis.confidence < AIAssistant.LOW_CONFIDENCE_THRESHOLD;

      const clarificationQuestion = needsClarification
        ? aiAssistant.getClarificationQuestion(analysis)
        : null;

      // Update machine context with analysis results
      machine.updateContext({
        pendingTransactionData,
        needsClarification,
        clarificationQuestion,
      });

      // Transition through analysis
      machine.transition(ChatEvent.ANALYSIS_COMPLETE);

      // If we need clarification, transition the state machine accordingly
      if (needsClarification) {
        machine.transition(ChatEvent.RECEIVE_CLARIFICATION);
      }

      // Determine if we should auto-trigger transaction
      const shouldAutoTrigger =
        !needsClarification &&
        !machineSnapshot.context.hasUserCancelled &&
        (newMessageCount >= 5 ||
          (hasMinimalTransactionData &&
            newMessageCount >= 3 &&
            analysis.intent === 'fiat_conversion'));

      const shouldTriggerTransaction =
        shouldAutoTrigger && hasMinimalTransactionData;

      // If ready for transaction, attempt transition
      if (shouldAutoTrigger && hasMinimalTransactionData) {
        machine.updateContext({ pendingTransactionData });
        machine.transition(ChatEvent.TRIGGER_TRANSACTION);
      }

      // If we didn't enter a terminal/transaction/clarification state, return to awaiting input
      if (
        machine.getState().state === ChatState.ANALYZING &&
        machine.canTransition(ChatEvent.ANALYSIS_COMPLETE)
      ) {
        machine.transition(ChatEvent.ANALYSIS_COMPLETE);
      }

      // Build response message
      let enhancedResponse = analysis.suggestedResponse;

      if (needsClarification && clarificationQuestion) {
        enhancedResponse = `**One quick clarification**: ${clarificationQuestion}`;
      }

      if (
        !needsClarification &&
        newMessageCount >= 3 &&
        hasMinimalTransactionData &&
        !machineSnapshot.context.hasUserCancelled
      ) {
        enhancedResponse += `

**Ready to Proceed**: I have the details needed for your conversion. Let me set this up for you to review and sign.`;
      } else if (
        !needsClarification &&
        newMessageCount >= 4 &&
        !hasMinimalTransactionData &&
        !machineSnapshot.context.hasUserCancelled
      ) {
        enhancedResponse += `

**Let's Complete This**: To proceed with your conversion, I'll need either the token amount you want to convert or your desired fiat amount. Once I have that, we can proceed to the secure signing process.`;
      }

      if (!connection.isConnected && analysis.intent === 'fiat_conversion') {
        enhancedResponse +=
          "\\n\\n**Quick Setup**: I notice your wallet isn't connected yet. I'll help you connect it first for a seamless conversion experience.";
      }

      if (
        analysis.intent === 'fiat_conversion' &&
        analysis.extractedData?.tokenIn
      ) {
        const tokenSymbol = analysis.extractedData.tokenIn;
        enhancedResponse += `

**Market Context**: I'll check current ${tokenSymbol} rates to ensure you get the best conversion value.`;
      }

      if (isCancellation) {
        enhancedResponse =
          "**Conversion Cancelled**\\n\\nNo problem! I've cancelled the transaction process. Feel free to start fresh whenever you're ready to convert crypto to fiat. I'm here to help whenever you need assistance.\\n\\nIs there anything else I can help you with today?";
      }

      const shouldShowTransactionData =
        analysis.intent === 'fiat_conversion' &&
        analysis.extractedData &&
        (analysis.extractedData.tokenIn ||
          analysis.extractedData.amountIn ||
          analysis.extractedData.fiatAmount);

      setMessages((prev: ChatMessage[]) =>
        prev.map((m) =>
          m.id === pendingAssistantId
            ? {
              ...m,
              content: enhancedResponse,
              metadata: {
                ...m.metadata,
                status: 'sent',
                guardrail: analysis.guardrail,
                transactionData: shouldShowTransactionData
                  ? (analysis.extractedData as TransactionData)
                  : undefined,
                suggestedActions: generateSuggestedActions(analysis, {
                  isWalletConnected: connection.isConnected,
                  messageCount: newMessageCount,
                  hasTransactionData: !!pendingTransactionData,
                  shouldAutoTrigger: !!shouldAutoTrigger,
                  isAdmin: isAdmin,
                  lowConfidence: needsClarification,
<<<<<<< HEAD:dex_with_fiat_frontend/src/hooks/useChat.ts
                  clarificationQuestion: clarificationQuestion || undefined,
                },
            }
            : m,
        ),
      );

      setMessages((prev: ChatMessage[]) =>
        prev.map((m) =>
          m.id === optimisticUserId
            ? {
                ...m,
                metadata: {
                  ...m.metadata,
                  status: 'sent',
                },
              }
=======
                }),
                confirmationRequired:
                  analysis.intent === 'fiat_conversion' ||
                  shouldTriggerTransaction,
                autoTriggerTransaction: shouldTriggerTransaction,
                conversationCount: newMessageCount,
                lowConfidence: needsClarification,
                clarificationQuestion: clarificationQuestion || undefined,
              },
            }
>>>>>>> origin/main:Dechat/dex_with_fiat_frontend/src/hooks/useChat.ts
            : m,
        ),
      );

      // Trigger transaction callback if needed. Track the timer so it can be
      // cleared on unmount and avoid post-dismount state updates (leak #663).
      if (shouldAutoTrigger && pendingTransactionData && onTransactionReady) {
        if (transactionReadyTimerRef.current !== null) {
          clearTimeout(transactionReadyTimerRef.current);
        }
        transactionReadyTimerRef.current = setTimeout(() => {
          transactionReadyTimerRef.current = null;
          onTransactionReady(pendingTransactionData);
        }, 1000);
      }
    },
    [aiAssistant, connection, isAdmin, onTransactionReady],
  );

  const replayQueuedSends = useCallback(async () => {
    if (replayingQueueRef.current || queuedSendsRef.current.length === 0) {
      return;
    }
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      return;
    }

    replayingQueueRef.current = true;

    while (queuedSendsRef.current.length > 0) {
      const queued = queuedSendsRef.current.shift();
      if (!queued) {
        break;
      }

      const requestController = new AbortController();
      activeRequestControllerRef.current = requestController;
      setIsLoading(true);

      try {
        await analyzeAndRespond(
          queued.content,
          queued.optimisticUserId,
          queued.pendingAssistantId,
          queued.machineSnapshot,
          requestController,
        );
        void removeQueuedMessage(queued.optimisticUserId);
        setQueuedMessageCount(queuedSendsRef.current.length);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          break;
        }

        if (isLikelyNetworkError(error)) {
          queuedSendsRef.current.unshift(queued);
          break;
        }

        console.error('Chat replay error:', error);
        markMessageFailed(queued.pendingAssistantId, queued.optimisticUserId);
        void removeQueuedMessage(queued.optimisticUserId);
        setQueuedMessageCount(queuedSendsRef.current.length);
        if (machineRef.current.canTransition(ChatEvent.ENCOUNTER_ERROR)) {
          machineRef.current.transition(ChatEvent.ENCOUNTER_ERROR);
        }
      } finally {
        if (activeRequestControllerRef.current === requestController) {
          activeRequestControllerRef.current = null;
          setIsLoading(false);
        }
      }
    }

    replayingQueueRef.current = false;
  }, [analyzeAndRespond, isLikelyNetworkError, markMessageFailed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      void replayQueuedSends();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [replayQueuedSends]);

  // Restore any messages still queued in IndexedDB from a previous page
  // load (covers a reload while offline) and try to send them right away.
  useEffect(() => {
    void getAllQueuedMessages().then((records) => {
      if (records.length === 0) {
        return;
      }
      records
        .sort((a, b) => a.queuedAt - b.queuedAt)
        .forEach((record) => {
          queuedSendsRef.current.push({
            content: record.content,
            optimisticUserId: record.optimisticUserId,
            pendingAssistantId: record.pendingAssistantId,
            machineSnapshot: record.machineSnapshot as QueuedSend['machineSnapshot'],
          });
        });
      setQueuedMessageCount(queuedSendsRef.current.length);
      void replayQueuedSends();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const machine = machineRef.current;
      const machineState = machine.getState();

      // Only proceed if in valid state
      if (!machine.canTransition(ChatEvent.SEND_MESSAGE)) {
        console.warn('Cannot send message in current state:', machineState.state);
        return;
      }

      // Abort any in-flight request — read the ref directly to avoid a stale
      // closure on the isLoading state value (issue #530).
      if (activeRequestControllerRef.current) {
        activeRequestControllerRef.current.abort();
        activeRequestControllerRef.current = null;
      }

      // Use crypto.randomUUID (or a monotonic fallback) to guarantee unique IDs
      // even when two messages are created within the same millisecond — the
      // original Date.now() / Date.now()+1 pattern was the root cause of the
      // race condition reported in issue #530.
      const uid = () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Add user message
      const optimisticUserId = uid();
      const userMessage: ChatMessage = {
        id: optimisticUserId,
        role: 'user',
        content,
        timestamp: new Date(),
        metadata: {
          status: 'pending',
        },
        originalPayload: {
          content,
        },
      };

      const pendingAssistantId = uid();
      const pendingAssistantMessage: ChatMessage = {
        id: pendingAssistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        metadata: {
          status: 'pending',
        },
      };

      setMessages((prev: ChatMessage[]) => [
        ...prev,
        userMessage,
        pendingAssistantMessage,
      ]);
      setIsLoading(true);

      // Transition to SENDING_MESSAGE
      machine.transition(ChatEvent.SEND_MESSAGE);

      const machineSnapshot: QueuedSend['machineSnapshot'] = {
        state: machineState.state,
        context: {
          ...machineState.context,
          pendingTransactionData: machineState.context.pendingTransactionData
            ? { ...machineState.context.pendingTransactionData }
            : null,
        },
      };

      // If offline at send time, queue and replay on reconnect.
      if (typeof window !== 'undefined' && !window.navigator.onLine) {
        queuedSendsRef.current.push({
          content,
          optimisticUserId,
          pendingAssistantId,
          machineSnapshot,
        });
        void addQueuedMessage({
          id: optimisticUserId,
          content,
          optimisticUserId,
          pendingAssistantId,
          machineSnapshot,
          queuedAt: Date.now(),
        });
        setQueuedMessageCount(queuedSendsRef.current.length);
        setIsLoading(false);
        return;
      }

      const requestController = new AbortController();
      activeRequestControllerRef.current = requestController;

      try {
        await analyzeAndRespond(
          content,
          optimisticUserId,
          pendingAssistantId,
          machineSnapshot,
          requestController,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (isLikelyNetworkError(error)) {
          queuedSendsRef.current.push({
            content,
            optimisticUserId,
            pendingAssistantId,
            machineSnapshot,
          });
          void addQueuedMessage({
            id: optimisticUserId,
            content,
            optimisticUserId,
            pendingAssistantId,
            machineSnapshot,
            queuedAt: Date.now(),
          });
          setQueuedMessageCount(queuedSendsRef.current.length);
          return;
        }

        console.error('Chat error:', error);
        markMessageFailed(pendingAssistantId, optimisticUserId);
        if (machine.canTransition(ChatEvent.ENCOUNTER_ERROR)) {
          machine.transition(ChatEvent.ENCOUNTER_ERROR);
        }
      } finally {
        if (activeRequestControllerRef.current === requestController) {
          activeRequestControllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [
      analyzeAndRespond,
      isLikelyNetworkError,
      markMessageFailed,
    ],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    machineRef.current.transition(ChatEvent.CLEAR_CHAT);
    createNewSession([]);
  }, [createNewSession]);

  const loadChatSession = useCallback(
    (sessionId: string) => {
      const sessionMessages = loadSession(sessionId);
      if (sessionMessages) {
        setMessages(
          sessionMessages.length > 0 ? sessionMessages : [initialMessage],
        );
        machineRef.current.transition(ChatEvent.LOAD_SESSION);
      }
    },
    [loadSession, initialMessage],
  );

  const setTransactionReadyCallback = useCallback(
    (callback: (data: TransactionData) => void) => {
      setOnTransactionReady(() => callback);
    },
    [],
  );

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, []);

  // Update suggested actions when wallet connection changes
  useEffect(() => {
    if (!hasHydrated) return;
    const machine = machineRef.current;
    if (machine.getState().state !== ChatState.UNINITIALIZED) {
      setMessages((prevMessages: ChatMessage[]) => {
        if (prevMessages.length > 0 && prevMessages[0]?.id === '1') {
          const updatedMessages = [...prevMessages];
          updatedMessages[0] = {
            ...updatedMessages[0],
            metadata: {
              ...updatedMessages[0].metadata,
              suggestedActions: getInitialSuggestedActions(),
            },
          };
          return updatedMessages;
        }
        return prevMessages;
      });
    }
  }, [connection.isConnected, getInitialSuggestedActions, hasHydrated]);

  // Derive conversationState from machine for backward compatibility
  const conversationState = useMemo((): ConversationState => {
    const machineState = machineRef.current.getState();
    return {
      messageCount: machineState.context.messageCount,
      hasUserCancelled: machineState.context.hasUserCancelled,
      pendingTransactionData: machineState.context.pendingTransactionData,
      shouldTriggerTransaction: machineState.state === ChatState.TRANSACTION_TRIGGERED,
      isAdmin,
      awaitingClarification: machineState.state === ChatState.AWAITING_CLARIFICATION,
      clarificationQuestion: machineState.context.clarificationQuestion,
    };
    // stateUpdateTrigger is intentionally included to force re-computation when machine state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, stateUpdateTrigger]);

  return {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    loadChatSession,
    currentSessionId,
    conversationState,
    setTransactionReadyCallback,
    setIsAdmin: setIsAdminState,
    cancelPendingRequest,
    copyToClipboard,
    addMessage: (message: ChatMessage) => {
      const newMessages = [...messages, message];
      setMessages((prev: ChatMessage[]) => [...prev, message]);
      // Update session with new messages
      updateCurrentSession(newMessages);
    },
  };
};

function generateSuggestedActions(
  analysis: AIAnalysisResult,
  context?: {
    isWalletConnected: boolean;
    messageCount?: number;
    hasTransactionData?: boolean;
    shouldAutoTrigger?: boolean;
    isAdmin?: boolean;
    lowConfidence?: boolean;
  },
) {
  const actions = [];
  const isConnected = context?.isWalletConnected || false;
  const messageCount = context?.messageCount || 0;
  const hasTransactionData = context?.hasTransactionData || false;
  const shouldAutoTrigger = context?.shouldAutoTrigger || false;
  const isAdmin = context?.isAdmin || false;
  const lowConfidence = context?.lowConfidence || false;

  if (analysis.intent === 'guardrail' && analysis.guardrail) {
    return generateGuardrailActions(analysis.guardrail.category, isConnected);
  }

  if (shouldAutoTrigger && hasTransactionData) {
    actions.push({
      id: 'auto_proceed',
      type: 'confirm_fiat' as const,
      label: '🚀 Complete Transaction',
      priority: true,
    });
    actions.push({
      id: 'cancel_flow',
      type: 'cancel' as const,
      label: 'Cancel',
    });
    return actions;
  }

  if (
    messageCount >= 3 &&
    hasTransactionData &&
    !shouldAutoTrigger &&
    !lowConfidence
  ) {
    actions.push({
      id: 'proceed_now',
      type: 'confirm_fiat' as const,
      label: '✨ Proceed with Conversion',
      priority: true,
    });
  }

  if (
    analysis.intent === 'fiat_conversion' &&
    analysis.extractedData &&
    (analysis.extractedData.tokenIn ||
      analysis.extractedData.fiatAmount ||
      analysis.extractedData.fiatCurrency)
  ) {
    if (!isConnected) {
      actions.push({
        id: 'connect_first',
        type: 'connect_wallet' as const,
        label: 'Connect Wallet First',
      });
    }

    if (!shouldAutoTrigger && !lowConfidence) {
      actions.push({
        id: 'proceed_conversion',
        type: 'confirm_fiat' as const,
        label: 'Proceed with Conversion',
        data: analysis.extractedData,
      });
    }

    actions.push({
      id: 'check_rates',
      type: 'market_rates' as const,
      label: 'Check Current Rates',
    });
  }

  if (analysis.intent === 'portfolio') {
    if (!isConnected) {
      actions.push({
        id: 'connect_portfolio',
        type: 'connect_wallet' as const,
        label: 'Connect for Portfolio',
      });
    } else {
      actions.push(
        {
          id: 'view_portfolio',
          type: 'check_portfolio' as const,
          label: 'View Portfolio',
        },
        {
          id: 'convert_options',
          type: 'confirm_fiat' as const,
          label: 'Conversion Options',
        },
      );
    }
  }

  // Admin-only actions
  if (isAdmin) {
    actions.push({
      id: 'admin_withdraw',
      type: 'confirm_fiat' as const,
      label: '💰 Admin: Withdraw Funds',
      data: { isWithdraw: true },
    });
  }

  if (analysis.intent === 'query') {
    const content = analysis.suggestedResponse?.toLowerCase() || '';
    const hasConversionKeywords = [
      'convert',
      'cash',
      'fiat',
      'bank',
      'withdraw',
      'sell',
    ].some((keyword) => content.includes(keyword));
    if (hasConversionKeywords && !lowConfidence) {
      actions.push(
        {
          id: 'start_conversion',
          type: 'confirm_fiat' as const,
          label: 'Deposit XLM',
        },
        {
          id: 'market_info',
          type: 'market_rates' as const,
          label: 'Market Info',
        },
      );
    } else {
      actions.push({
        id: 'convert_crypto',
        type: 'confirm_fiat' as const,
        label: 'Convert Crypto',
      });

      if (isConnected) {
        actions.push({
          id: 'portfolio_check',
          type: 'check_portfolio' as const,
          label: 'Check Portfolio',
        });
      }

      actions.push({
        id: 'learn_process',
        type: 'learn_more' as const,
        label: 'Learn Process',
      });
    }
  }

  if (analysis.intent === 'technical_support') {
    actions.push(
      { id: 'retry_action', type: 'confirm_fiat' as const, label: 'Try Again' },
      {
        id: 'check_status',
        type: 'check_portfolio' as const,
        label: 'Check Status',
      },
    );
  }

  if (analysis.intent === 'unknown') {
    actions.push(
      {
        id: 'explore_conversion',
        type: 'confirm_fiat' as const,
        label: 'Explore Conversions',
      },
      {
        id: 'how_it_works',
        type: 'learn_more' as const,
        label: 'How It Works',
      },
    );
  }

  return actions;
}

function generateGuardrailActions(
  category: GuardrailCategory,
  isWalletConnected: boolean,
) {
  const actions = [];

  if (!isWalletConnected) {
    actions.push({
      id: 'guardrail_connect_wallet',
      type: 'connect_wallet' as const,
      label: 'Connect Freighter',
    });
  }

  if (category === 'unsupported_request') {
    actions.push({
      id: 'guardrail_supported_question',
      type: 'query' as const,
      label: 'Show Supported Tasks',
      data: {
        query:
          'What supported actions can you help me with in Stellar Dex Chat?',
      },
    });
  }

  actions.push({
    id: 'guardrail_market_rates',
    type: 'market_rates' as const,
    label: 'Check XLM Rates',
  });
  actions.push({
    id: 'guardrail_learn_more',
    type: 'learn_more' as const,
    label: 'How It Works',
  });

  return actions;
}

export default useChat;
