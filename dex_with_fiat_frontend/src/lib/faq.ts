export interface FAQEntry {
  questions: string[];
  answer: string;
  intent: 'query' | 'fiat_conversion' | 'portfolio' | 'technical_support';
}

export const FAQ_DATA: FAQEntry[] = [
  {
    questions: [
      'how to deposit',
      'how do i deposit',
      'deposit xlm',
      'how to add funds',
    ],
    answer:
      "To deposit XLM, you can use the `/deposit` command or simply say 'I want to deposit [amount] XLM'. I'll then guide you through connecting your Freighter wallet and signing the transaction on the Stellar testnet.",
    intent: 'fiat_conversion',
  },
  {
    questions: [
      'current rates',
      'xlm price',
      'conversion rates',
      'exchange rate',
    ],
    answer:
      'You can check real-time XLM market rates by typing `/rates`. Our platform uses industry-standard price feeds to ensure you get the best value for your conversions.',
    intent: 'query',
  },
  {
    questions: [
      'supported currencies',
      'what fiat do you support',
      'fiat options',
    ],
    answer:
      'We currently support conversions from XLM to Nigerian Naira (NGN), US Dollars (USD), and Euros (EUR) via secure bank transfers.',
    intent: 'query',
  },
  {
    questions: ['is it safe', 'security', 'secure'],
    answer:
      'Security is our top priority. All transactions are processed via non-custodial smart contracts on the Stellar network. We never have access to your private keys, and bank transfers are end-to-end encrypted.',
    intent: 'technical_support',
  },
  {
    questions: ['how to connect wallet', 'freighter wallet', 'connect wallet'],
    answer:
      "To connect your wallet, click the 'Connect Wallet' button in the header or type `/help`. We support the Freighter wallet for secure transaction signing on the Stellar network.",
    intent: 'technical_support',
  },
  {
    questions: ['portfolio', 'my balance', 'check balance', 'check xlm'],
    answer:
      'You can view your current XLM balance and portfolio value by typing `/portfolio`. Make sure your wallet is connected to see real-time data.',
    intent: 'portfolio',
  },
];

export function findFAQMatch(message: string): FAQEntry | null {
  const normalized = message.toLowerCase().trim();

  for (const entry of FAQ_DATA) {
    if (entry.questions.some((q) => normalized.includes(q.toLowerCase()))) {
      return entry;
    }
  }

  return null;
}
