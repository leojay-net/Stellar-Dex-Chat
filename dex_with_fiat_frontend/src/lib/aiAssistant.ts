import {
  AIAnalysisResult,
  GuardrailCategory,
  GuardrailResult,
  TransactionData,
} from '@/types';
import { telemetry } from '@/lib/telemetry';

type GuardrailMatch = {
  category: GuardrailCategory;
  reason: string;
};

/**
 * A helper utility class managing AI message analysis and guardrail protection
 * for the Stellar FiatBridge frontend assistant.
 */
export class AIAssistant {
  private static guardrailCounts: Record<GuardrailCategory, number> = {
    unsupported_request: 0,
    wallet_security: 0,
    compliance_evasion: 0,
    malicious_activity: 0,
    financial_guarantee: 0,
  };

  static readonly LOW_CONFIDENCE_THRESHOLD = 0.7;

  /**
   * Analyze the user message and produce a structured AI analysis result.
   * Includes guardrail checks, FAQ matching, deterministic parsing, AI model
   * generation, and merged extracted data.
   *
   * @param message - Incoming user query or request text.
   * @param context - Optional context values to include in the AI prompt.
   * @returns AIAnalysisResult with determined intent and suggested response.
   */
  async analyzeUserMessage(
    message: string,
    context?: Record<string, unknown>,
  ): Promise<AIAnalysisResult> {
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context }),
      });

      if (!response.ok) {
        throw new Error(`AI chat API returned ${response.status}`);
      }

      const result: AIAnalysisResult = await response.json() as AIAnalysisResult;

      // Record any guardrail triggers for telemetry
      if (result.guardrail?.triggered) {
        this.recordGuardrailTrigger(
          {
            category: result.guardrail.category,
            reason: result.guardrail.reason,
          },
          message,
        );
      }

      return result;
    } catch (error) {
      console.error('AI Analysis Error:', error);
      return {
        intent: 'unknown',
        confidence: 0,
        extractedData: {},
        requiredQuestions: [],
        suggestedResponse:
          "I'm having trouble understanding your request. Could you please rephrase it?",
        guardrail: undefined,
      };
    }
  }

  /**
   * Build the prompt text that is sent to the AI model for analysis.
   *
   * @param message - Raw user message for analysis.
   * @param context - Optional additional context values.
   * @returns A fully composed prompt string for the AI model.
   */
  private buildAnalysisPrompt(
    message: string,
    context?: Record<string, unknown>,
  ): string {
    return `
You are a professional AI agent specializing in cryptocurrency-to-fiat conversions on the Stellar network. You help users deposit XLM into the Stellar FiatBridge smart contract and convert crypto to fiat via secure bank transfers.

PERSONALITY & TONE:
- Professional yet friendly and approachable
- Clear, concise communication
- Proactive in guiding users through the process
- Confident and knowledgeable about Stellar/Soroban and traditional finance

User Message: "${message}"
Context: ${context ? JSON.stringify(context) : 'None'}

CORE CAPABILITIES:
1. XLM to fiat conversions (XLM → NGN, USD, EUR) - Primary Focus
2. Stellar FiatBridge smart contract interactions (deposit, withdraw, check limits)
3. Real-time XLM market rate analysis
4. Transaction tracking on Stellar Expert (testnet)
5. Account setup and Freighter wallet guidance
6. XLM portfolio balance management

CONVERSATION FLOW INTELLIGENCE:
- Greetings: Welcome users warmly, focus on XLM conversions via Stellar
- Conversion requests: Extract XLM details, provide rate quotes, guide through process
- Questions: Answer knowledgeably about XLM, Stellar, Soroban, Freighter, DeFi
- Technical issues: Provide clear troubleshooting guidance for Freighter / Soroban
- Missing info: Ask targeted follow-up questions naturally

EXTRACTION GUIDELINES:
- Set intent to "fiat_conversion" only when user explicitly wants to deposit XLM or convert XLM to fiat
- Set intent to "query" for questions, information requests, or casual conversation
- Set intent to "portfolio" for XLM balance checks, asset inquiries about Stellar assets
- Set intent to "guardrail" for unsupported requests or risky requests involving private keys, bypassing compliance, exploits, scams, or guaranteed returns
- Set intent to "unknown" only if completely unclear
- Always assume XLM when referring to tokens (we support XLM on Stellar)
- If the user seems to want a conversion but amount, payout target, or currency is missing or ambiguous, keep intent as "fiat_conversion", set confidence below 0.7, and include one targeted follow-up question in "requiredQuestions"
- When confidence is below 0.7, keep "suggestedResponse" focused on that single clarification instead of saying the transaction is ready

Respond with a JSON object in this exact format:
{
    "intent": "fiat_conversion|query|portfolio|technical_support|guardrail|unknown",
  "confidence": 0.8,
  "extractedData": {
    "type": "fiat_conversion",
    "tokenIn": "XLM",
    "amountIn": "1000",
    "fiatAmount": "1000",
    "fiatCurrency": "NGN"
  },
  "requiredQuestions": ["What amount of XLM would you like to deposit/convert?"],
  "suggestedResponse": "I'd be happy to help you convert your XLM to Nigerian Naira via the Stellar FiatBridge!",
  "guardrail": {
    "triggered": false,
    "category": "unsupported_request",
    "reason": ""
  }
}

EXAMPLE RESPONSES BY INTENT:

GREETING/WELCOME:
{
  "intent": "query",
  "confidence": 0.95,
  "extractedData": {},
  "requiredQuestions": [],
  "suggestedResponse": "Hello! I'm your personal USDT-to-fiat conversion specialist. I can help you seamlessly convert your USDT stablecoin to local currency (NGN, USD, EUR) through secure bank transfers. Whether you want to cash out a small amount or large holdings, I'll guide you through the entire process. What can I help you with today?"
}

GENERAL QUERY:
{
  "intent": "query", 
  "confidence": 0.85,
  "extractedData": {},
  "requiredQuestions": [],
  "suggestedResponse": "Great question! I'm here to help with that. [Provide helpful answer and naturally guide toward USDT conversion services]"
}

PORTFOLIO CHECK:
{
  "intent": "portfolio",
  "confidence": 0.9,
  "extractedData": {},
  "requiredQuestions": [],
  "suggestedResponse": "I can help you check your USDT balance and evaluate conversion opportunities. Let me connect to your wallet to provide real-time USDT balance information."
}

FIAT_CONVERSION EXAMPLE:
{
  "intent": "fiat_conversion",
  "confidence": 0.9,
  "extractedData": {
    "type": "fiat_conversion",
    "tokenIn": "XLM",
    "amountIn": "500",
    "fiatCurrency": "NGN"
  },
  "requiredQuestions": [],
  "suggestedResponse": "Perfect! I can help you deposit 500 XLM into the Stellar FiatBridge for conversion to Nigerian Naira. Let me prepare the deposit transaction for you to review and sign with Freighter."
}

Be conversational and helpful. Ask clarifying questions when information is missing. Always focus on XLM conversions on Stellar.
`;
  }

  /**
   * Classify a message against guardrail categories to prevent unsafe AI responses.
   *
   * @param message - The user-provided message to evaluate.
   * @returns GuardrailMatch when a guardrail-category trigger is matched, otherwise null.
   */
  private classifyGuardrail(message: string): GuardrailMatch | null {
    const normalized = message.toLowerCase();
    const mentionsSupportedDomain =
      /(xlm|stellar|soroban|freighter|wallet|fiat|deposit|withdraw|bank transfer|portfolio|contract|offramp|naira|ngn|usd|eur)/i.test(
        message,
      );

    if (
      /(seed phrase|secret phrase|private key|recovery phrase|mnemonic|passphrase|wallet secret)/i.test(
        normalized,
      )
    ) {
      return {
        category: 'wallet_security',
        reason:
          'Request involves sensitive wallet credentials or recovery data.',
      };
    }

    if (
      /(bypass kyc|avoid kyc|skip kyc|evade aml|avoid aml|bypass compliance|sanction|launder|money laundering|wash trading|hide funds)/i.test(
        normalized,
      )
    ) {
      return {
        category: 'compliance_evasion',
        reason:
          'Request appears to seek compliance evasion or illicit fund flows.',
      };
    }

    if (
      /(hack|exploit|drain|phish|steal|scam|spoof|backdoor|malware|keylogger|credential stuffing|rug pull)/i.test(
        normalized,
      )
    ) {
      return {
        category: 'malicious_activity',
        reason:
          'Request appears to facilitate fraud, exploits, or other malicious activity.',
      };
    }

    if (
      /(guarantee profit|guaranteed profit|risk-free return|sure profit|double my money|insider tip|pump this|financial advice)/i.test(
        normalized,
      )
    ) {
      return {
        category: 'financial_guarantee',
        reason:
          'Request asks for unsafe financial guarantees or promotional investment advice.',
      };
    }

    if (
      !mentionsSupportedDomain &&
      /(write|build|book|plan|recommend|recipe|summarize|translate|homework|essay|poem|code|movie|weather|hotel|flight|calendar|email)/i.test(
        normalized,
      )
    ) {
      return {
        category: 'unsupported_request',
        reason: 'Request falls outside the Stellar conversion assistant scope.',
      };
    }

    return null;
  }

  /**
   * Build an AIAnalysisResult payload when a guardrail has been triggered.
   *
   * @param match - The guardrail match details.
   * @param message - The original user message that triggered guardrails.
   * @returns AIAnalysisResult object intended for safe guardrail reply flow.
   */
  private buildGuardrailResponse(
    match: GuardrailMatch,
    message: string,
  ): AIAnalysisResult {
    const guardrail = this.recordGuardrailTrigger(match, message);

    return {
      intent: 'guardrail',
      confidence: 0.99,
      extractedData: {},
      requiredQuestions: [],
      suggestedResponse: this.buildSafeGuardrailTemplate(match.category),
      guardrail,
    };
  }

  /**
   * Record a guardrail trigger event and emit telemetry for auditing and stats.
   *
   * @param match - Guardrail match details including category and reason.
   * @param message - Original user message contents.
   * @returns GuardrailResult including trigger and total counts.
   */
  private recordGuardrailTrigger(
    match: GuardrailMatch,
    message: string,
  ): GuardrailResult {
    AIAssistant.guardrailCounts[match.category] += 1;

    const totalTriggerCount = Object.values(AIAssistant.guardrailCounts).reduce(
      (sum, count) => sum + count,
      0,
    );

    const traceId = telemetry.generateTraceId();
    const spanId = telemetry.generateSpanId();

    telemetry.logWithTrace('warn', 'AI guardrail triggered', traceId, spanId, {
      category: match.category,
      reason: match.reason,
      triggerCount: AIAssistant.guardrailCounts[match.category],
      totalTriggerCount,
      messagePreview: message.slice(0, 120),
    });

    return {
      triggered: true,
      category: match.category,
      reason: match.reason,
      triggerCount: AIAssistant.guardrailCounts[match.category],
      totalTriggerCount,
    };
  }

  /**
   * Build the user-facing guardrail response template based on category.
   *
   * @param category - The guardrail category that triggered.
   * @returns A formatted guardrail response string.
   */
  private buildSafeGuardrailTemplate(category: GuardrailCategory): string {
    const categoryLine = {
      unsupported_request:
        'I can only help with Stellar wallet, XLM conversion, and fiat off-ramp tasks in this app.',
      wallet_security:
        'I can\u2019t process or help expose private keys, seed phrases, or recovery credentials.',
      compliance_evasion:
        'I can\u2019t help bypass KYC, AML, sanctions, or other compliance controls.',
      malicious_activity:
        'I can\u2019t assist with exploits, scams, phishing, or unauthorized access.',
      financial_guarantee:
        'I can\u2019t promise profits or provide unsafe guaranteed-return guidance.',
    }[category];

    return `**Request Blocked by Guardrails**

${categoryLine}

**What I can help with instead**
- Deposit XLM into the Stellar FiatBridge flow
- Check XLM market rates and conversion estimates
- Explain how the Stellar offramp works
- Help connect your Freighter wallet safely

Choose one of the next actions below and I'll keep it moving.`;
  }

  /**
   * Parse the AI model string response into AIAnalysisResult with normalized fields.
   * Falls back to safe unknown result when parsing fails.
   *
   * @param response - Raw response text from AI generation service.
   * @returns AIAnalysisResult parsed or fallback message.
   */
  private parseAIResponse(response: string): AIAnalysisResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const extractedData = parsed.extractedData || {};
        const requiredQuestions = Array.isArray(parsed.requiredQuestions)
          ? parsed.requiredQuestions
          : [];
        const clarificationQuestion =
          requiredQuestions[0] ||
          this.buildClarificationQuestion(extractedData, parsed.intent);

        return {
          intent: parsed.intent || 'unknown',
          confidence: parsed.confidence || 0.5,
          extractedData,
          requiredQuestions:
            parsed.confidence < AIAssistant.LOW_CONFIDENCE_THRESHOLD &&
            clarificationQuestion
              ? [clarificationQuestion]
              : requiredQuestions,
          suggestedResponse:
            parsed.suggestedResponse || 'How can I help you today?',
          guardrail: parsed.guardrail,
        };
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
    }

    return {
      intent: 'unknown',
      confidence: 0,
      extractedData: {},
      requiredQuestions: [],
      suggestedResponse:
        response ||
        "How can I help you with your DeFi needs today? You can also say 'bridge tokens from Sepolia to Optimism' to use the CCIP bridge.",
      guardrail: undefined,
    };
  }

  /**
   * Generate a conversational follow-up question when required information is missing.
   *
   * @param intent - The inferred intent from analysis.
   * @param missingData - Array of missing data keys.
   * @returns A single conversational question string.
   */
  async generateFollowUpQuestion(
    intent: string,
    missingData: string[],
  ): Promise<string> {
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Generate a single, natural follow-up question for a Stellar DeFi assistant. Intent: ${intent}. Missing data: ${missingData.join(', ')}. Return only the question text.`,
        }),
      });
      if (response.ok) {
        const result = await response.json() as AIAnalysisResult;
        return result.suggestedResponse || 'Could you provide more details about your request?';
      }
    } catch (error) {
      console.error('Failed to generate follow-up question:', error);
    }
    return 'Could you provide more details about your request?';
  }

  /**
   * Determine the single best clarification question for user follow-up.
   *
   * @param analysis - AIAnalysisResult from the current analysis run.
   * @returns A clarification question string.
   */
  getClarificationQuestion(analysis: AIAnalysisResult): string {
    return (
      analysis.requiredQuestions[0] ||
      this.buildClarificationQuestion(analysis.extractedData, analysis.intent)
    );
  }

  /**
   * Create a follow-up question from extracted data and intent for missing fields.
   *
   * @param extractedData - Parsed data fields from AI parsing + deterministic parser.
   * @param intent - Currently assigned intent category.
   * @returns A user-friendly question for missing data.
   */
  private buildClarificationQuestion(
    extractedData: Partial<TransactionData>,
    intent: AIAnalysisResult['intent'],
  ): string {
    if (intent !== 'fiat_conversion') {
      return 'Could you clarify what you want to do with your XLM transfer?';
    }

    if (!extractedData.amountIn && !extractedData.fiatAmount) {
      return 'What amount of XLM would you like to deposit or what fiat amount should I target?';
    }

    if (!extractedData.fiatCurrency) {
      return 'Which fiat currency should I prepare the payout in, like NGN, USD, or EUR?';
    }

    if (!extractedData.recipient) {
      return 'Should I prepare this as a standard deposit for later payout review?';
    }

    return 'Could you confirm the last missing detail so I can prepare the correct transaction?';
  }

  /**
   * Validate transaction object fields and produce errors and suggestions.
   *
   * @param data - TransactionData payload to check for required parameters.
   * @returns Validation result with isValid, errors, and suggestions.
   */
  async validateTransactionData(data: TransactionData): Promise<{
    isValid: boolean;
    errors: string[];
    suggestions: string[];
  }> {
    const errors: string[] = [];
    const suggestions: string[] = [];

    if (data.type === 'fiat_conversion') {
      if (!data.tokenIn) errors.push('Token to convert is required');
      if (!data.amountIn && !data.fiatAmount) {
        errors.push('Either token amount or fiat amount is required');
      }
      if (!data.fiatCurrency) {
        suggestions.push(
          'Consider specifying the fiat currency (NGN, USD, etc.)',
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      suggestions,
    };
  }

  /**
   * Generate a user-facing receipt string for a transaction.
   *
   * @param transactionData - Optional transaction details used in receipt output.
   * @returns A textual receipt templated string.
   */
  async generateConversionReceipt(transactionData: {
    transactionId?: string;
    txHash?: string;
    amount?: string;
    token?: string;
    fiatCurrency?: string;
    estimatedFiat?: string;
    status?: string;
  }): Promise<string> {
    const currentTime = new Date().toLocaleString();
    const estimatedCompletion = new Date(
      Date.now() + 15 * 60000,
    ).toLocaleString();

    return `
**STELLAR FIATBRIDGE CONVERSION RECEIPT**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Transaction Details**
Transaction ID: ${transactionData.transactionId || 'TXN-' + Date.now()}
Stellar Hash: ${transactionData.txHash || 'Pending...'}
Status: ${transactionData.status || 'Processing'}
Initiated: ${currentTime}
Est. Completion: ${estimatedCompletion}

**Conversion Summary**
From: ${transactionData.amount || 'N/A'} ${transactionData.token || 'XLM'} (deposited to FiatBridge)
To: ${transactionData.fiatCurrency || 'NGN'} ${transactionData.estimatedFiat || 'Calculating...'}
Exchange Rate: Market rate at execution
Platform Fee: 0.5% (Industry leading)

**Bank Transfer Details**
Method: Instant Bank Transfer
Network: Stellar (${transactionData.token === 'XLM' ? 'Testnet' : 'Stellar'})
Security: End-to-end encrypted
Compliance: Fully regulated & compliant

**Next Steps**
1. Deposit confirmed on Stellar ledger
2. FiatBridge smart contract execution complete
3. Bank transfer will be initiated upon admin withdrawal
4. Funds typically arrive within 5-15 minutes

**Track your transaction**
https://stellar.expert/explorer/testnet/tx/${transactionData.txHash || ''}

**Support Available 24/7**
Need assistance? I'm here to help track your transaction or answer any questions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Thank you for using DexFiat on Stellar! 
Your financial freedom is our priority.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `.trim();
  }

  /**
   * Generate a mock market update message (used in assistant responses).
   *
   * @param tokenSymbol - Optional token symbol, defaults to XLM.
   * @returns A market update string including mock prices.
   */
  async generateMarketUpdate(tokenSymbol: string = 'XLM'): Promise<string> {
    const mockPrice = tokenSymbol === 'ETH' ? 2850 : 1850;
    const mockChange = Math.random() > 0.5 ? '+' : '-';
    const mockPercent = (Math.random() * 5).toFixed(2);

    return `
**LIVE MARKET UPDATE - ${tokenSymbol.toUpperCase()}**

Current Price: $${mockPrice.toLocaleString()} USD
24h Change: ${mockChange}${mockPercent}%
Best Time to Convert: ${Math.random() > 0.5 ? 'Good opportunity' : 'Consider waiting'}

Our AI suggests: ${
      Math.random() > 0.5
        ? 'Market conditions are favorable for conversion'
        : 'Price trending upward - you might want to hold or convert partially'
    }

Ready to convert? I can help you get the best rates with minimal fees.
        `.trim();
  }
}
