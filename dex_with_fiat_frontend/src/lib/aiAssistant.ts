import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIAnalysisResult, TransactionData } from '@/types';
import { env } from '@/lib/env';

const genAI = new GoogleGenerativeAI(env.NEXT_PUBLIC_GEMINI_API_KEY);

export class AIAssistant {
  private model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  async analyzeUserMessage(
    message: string,
    context?: Record<string, unknown>,
  ): Promise<AIAnalysisResult> {
    try {
      const prompt = this.buildAnalysisPrompt(message, context);
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      return this.parseAIResponse(response);
    } catch (error) {
      console.error('AI Analysis Error:', error);
      return {
        intent: 'unknown',
        confidence: 0,
        extractedData: {},
        requiredQuestions: [],
        suggestedResponse:
          "I'm having trouble understanding your request. Could you please rephrase it?",
      };
    }
  }

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
1. XLM to fiat conversions (XLM → NGN, USD, EUR) — Primary Focus
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
- Set intent to "unknown" only if completely unclear
- Always assume XLM when referring to tokens (we support XLM on Stellar)

Respond with a JSON object in this exact format:
{
    "intent": "fiat_conversion|query|portfolio|technical_support|unknown",
  "confidence": 0.8,
  "extractedData": {
    "type": "fiat_conversion",
    "tokenIn": "XLM",
    "amountIn": "1000",
    "fiatAmount": "1000",
    "fiatCurrency": "NGN"
  },
  "requiredQuestions": ["What amount of XLM would you like to deposit/convert?"],
  "suggestedResponse": "I'd be happy to help you convert your XLM to Nigerian Naira via the Stellar FiatBridge!"
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

  private parseAIResponse(response: string): AIAnalysisResult {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          intent: parsed.intent || 'unknown',
          confidence: parsed.confidence || 0.5,
          extractedData: parsed.extractedData || {},
          requiredQuestions: parsed.requiredQuestions || [],
          suggestedResponse:
            parsed.suggestedResponse || 'How can I help you today?',
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
    };
  }

  async generateFollowUpQuestion(
    intent: string,
    missingData: string[],
  ): Promise<string> {
    const prompt = `
Generate a natural follow-up question for a DeFi trading assistant.

Intent: ${intent}
Missing Data: ${missingData.join(', ')}

Generate a single, conversational question to collect the missing information.
Be helpful and specific about what you need.
`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('Failed to generate follow-up question:', error);
      return 'Could you provide more details about your request?';
    }
  }

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
    ).toLocaleString(); // 15 minutes from now

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

  async generateMarketUpdate(tokenSymbol: string = 'XLM'): Promise<string> {
    // In a real implementation, you'd fetch actual market data
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
