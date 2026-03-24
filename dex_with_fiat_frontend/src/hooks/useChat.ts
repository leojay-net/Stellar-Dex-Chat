'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChatMessage, AIAnalysisResult, TransactionData } from '@/types';
import { AIAssistant } from '@/lib/aiAssistant';
import { useStellarWallet } from '@/contexts/StellarWalletContext';
import { useChatHistory } from './useChatHistory';

interface ConversationState {
  messageCount: number;
  hasUserCancelled: boolean;
  pendingTransactionData: TransactionData | null;
  shouldTriggerTransaction: boolean;
}

const useChat = () => {
  const { connection } = useStellarWallet();
  const {
    createNewSession,
    updateCurrentSession,
    loadSession,
    currentSessionId,
    currentSession,
  } = useChatHistory();

  // Conversation flow state
  const [conversationState, setConversationState] = useState<ConversationState>(
    {
      messageCount: 0,
      hasUserCancelled: false,
      pendingTransactionData: null,
      shouldTriggerTransaction: false,
    },
  );

  // Modal trigger callback - this will be passed to the chat interface
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

${
  connection.isConnected
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
  const [isInitialized, setIsInitialized] = useState(false);
  const aiAssistant = useMemo(() => new AIAssistant(), []);

  useEffect(() => {
    if (!isInitialized) {
      if (currentSession && currentSession.messages.length > 0) {
        setMessages(currentSession.messages);
      } else if (!currentSessionId) {
        setMessages([]);
        createNewSession([]);
      }
      setIsInitialized(true);
    }
  }, [
    currentSession,
    currentSessionId,
    createNewSession,
    initialMessage,
    isInitialized,
  ]);

  useEffect(() => {
    if (isInitialized && currentSessionId && messages.length > 0) {
      updateCurrentSession(messages);
    }
  }, [messages, currentSessionId, updateCurrentSession, isInitialized]);

  const sendMessage = useCallback(
    async (content: string) => {
      const isCancellation = /cancel|stop|no thanks|nevermind|abort/i.test(
        content,
      );
      if (isCancellation) {
        setConversationState((prev) => ({
          ...prev,
          hasUserCancelled: true,
          pendingTransactionData: null,
          shouldTriggerTransaction: false,
        }));
      }

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const conversationContext = {
          isWalletConnected: connection.isConnected,
          walletAddress: connection.address,
          previousMessages: messages
            .slice(-3)
            .map((m) => ({ role: m.role, content: m.content })),
          messageCount: conversationState.messageCount,
          hasTransactionData: !!conversationState.pendingTransactionData,
        };

        const analysis = await aiAssistant.analyzeUserMessage(
          content,
          conversationContext,
        );

        const newMessageCount = conversationState.messageCount + 1;
        let shouldTriggerTransaction = false;
        let pendingTransactionData = conversationState.pendingTransactionData;

        if (analysis.intent === 'fiat_conversion' && analysis.extractedData) {
          pendingTransactionData = {
            ...pendingTransactionData,
            ...analysis.extractedData,
          } as TransactionData;
        }

        const hasMinimalTransactionData =
          pendingTransactionData &&
          (pendingTransactionData.tokenIn ||
            pendingTransactionData.amountIn ||
            pendingTransactionData.fiatAmount);

        const shouldAutoTrigger =
          !conversationState.hasUserCancelled &&
          (newMessageCount >= 5 ||
            (hasMinimalTransactionData &&
              newMessageCount >= 3 &&
              analysis.intent === 'fiat_conversion'));

        if (shouldAutoTrigger && hasMinimalTransactionData) {
          shouldTriggerTransaction = true;
        }

        let enhancedResponse = analysis.suggestedResponse;

        if (
          newMessageCount >= 3 &&
          hasMinimalTransactionData &&
          !conversationState.hasUserCancelled
        ) {
          enhancedResponse += `

**Ready to Proceed**: I have the details needed for your conversion. Let me set this up for you to review and sign.`;
        } else if (
          newMessageCount >= 4 &&
          !hasMinimalTransactionData &&
          !conversationState.hasUserCancelled
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

        setConversationState((prev) => ({
          messageCount: newMessageCount,
          hasUserCancelled: isCancellation ? true : prev.hasUserCancelled,
          pendingTransactionData,
          shouldTriggerTransaction,
        }));

        const shouldShowTransactionData =
          analysis.intent === 'fiat_conversion' &&
          analysis.extractedData &&
          (analysis.extractedData.tokenIn ||
            analysis.extractedData.amountIn ||
            analysis.extractedData.fiatAmount);

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: enhancedResponse,
          timestamp: new Date(),
          metadata: {
            transactionData: shouldShowTransactionData
              ? (analysis.extractedData as TransactionData)
              : undefined,
            suggestedActions: generateSuggestedActions(analysis, {
              isWalletConnected: connection.isConnected,
              messageCount: newMessageCount,
              hasTransactionData: !!pendingTransactionData,
              shouldAutoTrigger: !!shouldAutoTrigger,
            }),
            confirmationRequired:
              analysis.intent === 'fiat_conversion' || shouldTriggerTransaction,
            autoTriggerTransaction: shouldTriggerTransaction,
            conversationCount: newMessageCount,
          },
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (
          shouldTriggerTransaction &&
          pendingTransactionData &&
          onTransactionReady
        ) {
          setTimeout(() => {
            onTransactionReady(pendingTransactionData);
          }, 1000);
        }
      } catch (error) {
        console.error('Chat error:', error);
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content:
            'Sorry, I encountered an error processing your request. Please try again.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [aiAssistant, conversationState, connection, messages, onTransactionReady],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationState({
      messageCount: 0,
      hasUserCancelled: false,
      pendingTransactionData: null,
      shouldTriggerTransaction: false,
    });
    createNewSession([]);
  }, [createNewSession]);

  const loadChatSession = useCallback(
    (sessionId: string) => {
      const sessionMessages = loadSession(sessionId);
      if (sessionMessages) {
        setMessages(
          sessionMessages.length > 0 ? sessionMessages : [initialMessage],
        );
        setConversationState({
          messageCount: 0,
          hasUserCancelled: false,
          pendingTransactionData: null,
          shouldTriggerTransaction: false,
        });
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

  useEffect(() => {
    if (isInitialized) {
      setMessages((prevMessages) => {
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
  }, [connection.isConnected, getInitialSuggestedActions, isInitialized]);

  return {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    loadChatSession,
    currentSessionId,
    conversationState,
    setTransactionReadyCallback,
    addMessage: (message: ChatMessage) => {
      const newMessages = [...messages, message];
      setMessages(newMessages);
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
  },
) {
  const actions = [];
  const isConnected = context?.isWalletConnected || false;
  const messageCount = context?.messageCount || 0;
  const hasTransactionData = context?.hasTransactionData || false;
  const shouldAutoTrigger = context?.shouldAutoTrigger || false;

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

  if (messageCount >= 3 && hasTransactionData && !shouldAutoTrigger) {
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

    if (!shouldAutoTrigger) {
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
    if (hasConversionKeywords) {
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

export default useChat;
