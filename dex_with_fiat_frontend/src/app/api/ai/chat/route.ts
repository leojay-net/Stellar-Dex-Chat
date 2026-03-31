import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '@/lib/env';
import { parseMessage, mergeParserWithAI } from '@/lib/messageParser';
import { findFAQMatch } from '@/lib/faq';
import {
  AIAnalysisResult,
  GuardrailCategory,
} from '@/types';

// ---------------------------------------------------------------------------
// Guardrail helpers (mirrors AIAssistant logic but runs server-side)
// ---------------------------------------------------------------------------

type GuardrailMatch = {
  category: GuardrailCategory;
  reason: string;
};

function classifyGuardrail(message: string): GuardrailMatch | null {
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
      reason: 'Request involves sensitive wallet credentials or recovery data.',
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

function buildSafeGuardrailTemplate(category: GuardrailCategory): string {
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

  return `**Request Blocked by Guardrails**\n\n${categoryLine}\n\n**What I can help with instead**\n- Deposit XLM into the Stellar FiatBridge flow\n- Check XLM market rates and conversion estimates\n- Explain how the Stellar offramp works\n- Help connect your Freighter wallet safely\n\nChoose one of the next actions below and I'll keep it moving.`;
}

function buildAnalysisPrompt(
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

EXTRACTION GUIDELINES:
- Set intent to "fiat_conversion" only when user explicitly wants to deposit XLM or convert XLM to fiat
- Set intent to "query" for questions, information requests, or casual conversation
- Set intent to "portfolio" for XLM balance checks
- Set intent to "guardrail" for unsupported or risky requests
- Set intent to "unknown" only if completely unclear
- Always assume XLM when referring to tokens

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
`;
}

function parseAIResponse(response: string): AIAnalysisResult {
  const LOW_CONFIDENCE_THRESHOLD = 0.7;
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const extractedData = parsed.extractedData || {};
      const requiredQuestions = Array.isArray(parsed.requiredQuestions)
        ? parsed.requiredQuestions
        : [];

      return {
        intent: parsed.intent || 'unknown',
        confidence: parsed.confidence || 0.5,
        extractedData,
        requiredQuestions:
          parsed.confidence < LOW_CONFIDENCE_THRESHOLD &&
          requiredQuestions[0]
            ? [requiredQuestions[0]]
            : requiredQuestions,
        suggestedResponse:
          parsed.suggestedResponse || 'How can I help you today?',
        guardrail: parsed.guardrail,
      };
    }
  } catch {
    // fall through to default
  }

  return {
    intent: 'unknown',
    confidence: 0,
    extractedData: {},
    requiredQuestions: [],
    suggestedResponse:
      response || 'How can I help you with your Stellar needs today?',
    guardrail: undefined,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      message: string;
      context?: Record<string, unknown>;
    };

    const { message, context } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: message is required' },
        { status: 400 },
      );
    }

    // 1. Check guardrails
    const guardrailMatch = classifyGuardrail(message);
    if (guardrailMatch) {
      const result: AIAnalysisResult = {
        intent: 'guardrail',
        confidence: 0.99,
        extractedData: {},
        requiredQuestions: [],
        suggestedResponse: buildSafeGuardrailTemplate(guardrailMatch.category),
        guardrail: {
          triggered: true,
          category: guardrailMatch.category,
          reason: guardrailMatch.reason,
          triggerCount: 1,
          totalTriggerCount: 1,
        },
      };
      return NextResponse.json(result);
    }

    // 2. Check local FAQ knowledge base
    const faqMatch = findFAQMatch(message);
    if (faqMatch) {
      const result: AIAnalysisResult = {
        intent: faqMatch.intent,
        confidence: 0.98,
        extractedData: {},
        requiredQuestions: [],
        suggestedResponse: faqMatch.answer,
      };
      return NextResponse.json(result);
    }

    // 3. Deterministic parser
    const parserResult = parseMessage(message);

    // 4. AI Analysis (server-side, key never leaves the server)
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      // Gracefully degrade if key is absent
      const result: AIAnalysisResult = {
        intent: 'unknown',
        confidence: 0,
        extractedData: parserResult,
        requiredQuestions: [],
        suggestedResponse:
          "I'm sorry, the AI assistant is not configured right now. Please try again later.",
      };
      return NextResponse.json(result);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = buildAnalysisPrompt(message, context);
    const aiResponse = await model.generateContent(prompt);
    const responseText = aiResponse.response.text();

    const aiResult = parseAIResponse(responseText);

    // 5. Merge — parser takes precedence for numeric fields
    aiResult.extractedData = mergeParserWithAI(
      parserResult,
      aiResult.extractedData,
    );

    return NextResponse.json(aiResult);
  } catch (error) {
    console.error('AI chat route error:', error);
    return NextResponse.json(
      {
        intent: 'unknown',
        confidence: 0,
        extractedData: {},
        requiredQuestions: [],
        suggestedResponse:
          "I'm having trouble processing your request. Could you please rephrase it?",
      } satisfies AIAnalysisResult,
      { status: 200 }, // Return 200 with fallback so the client still gets a response
    );
  }
}
