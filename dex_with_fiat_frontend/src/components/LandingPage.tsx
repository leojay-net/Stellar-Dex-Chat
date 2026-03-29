'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Shield,
  Zap,
  Globe,
  CheckCircle,
  Play,
  Lock,
  Code,
  Mail,
  MapPin,
  Phone,
  Github,
  Twitter,
  Linkedin,
  Star,
  Network,
  Cpu,
  FileText,
  HelpCircle,
  MessageSquare,
  Copy,
  Check,
  Sun,
  Moon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '../contexts/ThemeContext';

interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  delay: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  icon: Icon,
  title,
  description,
  delay,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`transform transition-all duration-700 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}
    >
      <div className="bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-xl p-6 hover:border-blue-500/50 transition-all duration-300 hover:bg-[var(--color-surface)] backdrop-blur-sm shadow-sm hover:shadow-md">
        <div className="flex items-center space-x-4 mb-4">
          <div className="w-12 h-12 bg-blue-600/10 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6 text-blue-500" />
          </div>
          <h3 className="text-xl font-semibold text-[var(--color-text-primary)]">{title}</h3>
        </div>
        <p className="text-[var(--color-text-secondary)] leading-relaxed">{description}</p>
      </div>
    </div>
  );
};

interface StepProps {
  number: number;
  title: string;
  description: string;
  delay: number;
}

const Step: React.FC<StepProps> = ({ number, title, description, delay }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`transform transition-all duration-700 ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}`}
    >
      <div className="flex items-start space-x-4">
        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold">{number}</span>
        </div>
        <div>
          <h4 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{title}</h4>
          <p className="text-[var(--color-text-secondary)]">{description}</p>
        </div>
      </div>
    </div>
  );
};

export default function LandingPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [heroVisible, setHeroVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const contractAddress =
    'CB4L7Q6M3N7Z6K4L2A3B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T3U4V5W6X7Y8Z9'; // Replace with actual deployed address

  useEffect(() => {
    setHeroVisible(true);
  }, []);

  const handleGetStarted = () => {
    router.push('/chat');
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(contractAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    // Here you would typically send the email to your backend
    setTimeout(() => {
      router.push('/chat');
    }, 1500);
  };

  const features = [
    {
      icon: Network,
      title: 'Soroban Smart Contracts',
      description:
        'FiatBridge contract built on Stellar Soroban — auditable, deterministic, and permissionless deposits with on-chain balance tracking.',
      delay: 200,
    },
    {
      icon: Zap,
      title: 'Instant Fiat Conversion',
      description:
        'Convert XLM to fiat in under 30 seconds. Direct bank transfers with real-time exchange rates and minimal fees on the Stellar network.',
      delay: 400,
    },
    {
      icon: Shield,
      title: 'Multi-Signature Security',
      description:
        'Admin-controlled withdrawal with on-chain authorization. Every deposit and withdrawal requires cryptographic signing via Freighter wallet.',
      delay: 600,
    },
    {
      icon: Lock,
      title: 'Non-Custodial Design',
      description:
        'Your XLM stays in the smart contract until an admin-authorized withdrawal. Full on-chain transparency via Stellar Expert.',
      delay: 800,
    },
    {
      icon: Globe,
      title: 'Global Fiat Rails',
      description:
        'Integrated with 200+ banking networks across 50+ countries with local currency support and regulatory compliance.',
      delay: 1000,
    },
    {
      icon: Code,
      title: 'Open Source Protocol',
      description:
        'Fully audited Soroban smart contracts with transparent fee structures, on-chain governance, and composable Stellar DeFi integrations.',
      delay: 1200,
    },
  ];

  const steps = [
    {
      number: 1,
      title: 'Install & Connect Freighter',
      description:
        "Install the Freighter browser extension (Stellar's native wallet). Connect to the Stellar Testnet and fund your wallet with XLM from Friendbot.",
      delay: 800,
    },
    {
      number: 2,
      title: 'Deposit XLM via Chat',
      description:
        'Tell the AI how much XLM you want to convert. It will prepare a Soroban contract call, which you sign with Freighter in one click.',
      delay: 1000,
    },
    {
      number: 3,
      title: 'Smart Contract Execution',
      description:
        'The Soroban FiatBridge contract records your deposit on-chain. Track your transaction in real time on Stellar Expert.',
      delay: 1200,
    },
    {
      number: 4,
      title: 'Instant Settlement',
      description:
        'Receive fiat in your bank account within minutes after admin withdrawal. Tax reporting and compliance documentation automated.',
      delay: 1400,
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] transition-colors duration-200">
      {/* Theme Toggle Button */}
      <div className="fixed top-6 right-6 z-50">
        <button
          onClick={toggleDarkMode}
          className="p-3 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] transition-all duration-300 shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode ? (
            <Sun className="w-5 h-5 text-yellow-400" />
          ) : (
            <Moon className="w-5 h-5 text-blue-600" />
          )}
        </button>
      </div>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl animate-pulse delay-1000"></div>
        </div>

        <div
          className={`relative z-10 text-center max-w-5xl mx-auto transform transition-all duration-1000 ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
        >
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              XLM-to-Fiat
            </span>{' '}
            Bridge
          </h1>

          <p className="text-xl md:text-2xl text-[var(--color-text-secondary)] mb-12 max-w-3xl mx-auto leading-relaxed">
            Convert Stellar Lumens (XLM) to fiat currency instantly through our
            AI-powered chat interface and Soroban smart contracts.
          </p>

          {/* How It Works Steps */}
          <div className="grid md:grid-cols-3 gap-8 mb-12 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-blue-400">1</span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                Connect Freighter
              </h3>
              <p className="text-[var(--color-text-muted)] text-sm">
                Install and connect your Stellar wallet to get started
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-blue-400">2</span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                Deposit XLM
              </h3>
              <p className="text-[var(--color-text-muted)] text-sm">
                Chat with AI to deposit XLM into the smart contract
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-blue-400">3</span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                Receive Fiat
              </h3>
              <p className="text-[var(--color-text-muted)] text-sm">
                Get fiat currency directly to your bank account
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
            <button
              onClick={handleGetStarted}
              className="group flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 px-8 py-4 rounded-lg text-lg font-semibold transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-blue-500/25"
            >
              <Play className="w-5 h-5" />
              <span>Start Bridging</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
            </button>

            <a
              href="https://stellar.expert/explorer/testnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-text-muted)] hover:text-blue-500 transition-colors duration-300 text-sm underline"
            >
              View on Stellar Expert →
            </a>
          </div>

          {/* Contract Address */}
          <div className="bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-lg p-4 max-w-md mx-auto">
            <p className="text-sm text-[var(--color-text-muted)] mb-2">Smart Contract Address</p>
            <div className="flex items-center justify-between">
              <code className="text-blue-400 font-mono text-sm break-all flex-1 mr-2">
                {contractAddress}
              </code>
              <button
                onClick={copyToClipboard}
                className="flex-shrink-0 p-1 hover:bg-gray-700 rounded transition-colors duration-200"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-400" />
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[var(--color-text-primary)]">
              Why Choose DexFiat on Stellar
            </h2>
            <p className="text-xl text-[var(--color-text-secondary)] max-w-3xl mx-auto">
              The most advanced XLM-to-fiat infrastructure powered by Soroban
              smart contracts on the Stellar network
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <FeatureCard key={index} {...feature} />
            ))}
          </div>
        </div>
      </section>

      {/* Technology Stack */}
      <section className="py-20 px-4 bg-[var(--color-surface-muted)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[var(--color-text-primary)]">
              Powered by Stellar Infrastructure
            </h2>
            <p className="text-xl text-[var(--color-text-secondary)] max-w-3xl mx-auto">
              Built on battle-tested Stellar protocols and cutting-edge Soroban
              smart contracts for maximum security and performance
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center p-6 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] hover:border-blue-500/50 transition-all duration-300">
              <Network className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-[var(--color-text-primary)]">Soroban</h3>
              <p className="text-[var(--color-text-secondary)] text-sm">
                Stellar&apos;s WebAssembly smart contract platform for secure
                on-chain logic
              </p>
            </div>
            <div className="text-center p-6 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] hover:border-purple-500/50 transition-all duration-300">
              <Shield className="w-12 h-12 text-purple-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-[var(--color-text-primary)]">Stellar Network</h3>
              <p className="text-[var(--color-text-secondary)] text-sm">
                Fast, low-cost Layer-1 with 5-second finality and $0.001 average
                fee
              </p>
            </div>
            <div className="text-center p-6 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] hover:border-green-500/50 transition-all duration-300">
              <Cpu className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-[var(--color-text-primary)]">AI-Optimized</h3>
              <p className="text-[var(--color-text-secondary)] text-sm">
                Gemini AI for optimal conversion advice, rate analysis, and
                guided UX
              </p>
            </div>
            <div className="text-center p-6 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] hover:border-yellow-500/50 transition-all duration-300">
              <Lock className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-[var(--color-text-primary)]">Freighter Wallet</h3>
              <p className="text-[var(--color-text-secondary)] text-sm">
                Native Stellar browser extension — secure signing with zero seed
                phrase exposure
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Supported Assets */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[var(--color-text-primary)]">
              Stellar Assets &amp; Fiat Currencies
            </h2>
            <p className="text-xl text-[var(--color-text-secondary)] max-w-3xl mx-auto">
              Deposit native Stellar assets and convert to 50+ fiat currencies
              worldwide
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-2xl font-semibold mb-6 flex items-center text-[var(--color-text-primary)]">
                <Network className="w-6 h-6 mr-3 text-blue-500" />
                Stellar Assets
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  'XLM (Native)',
                  'USDC on Stellar',
                  'yXLM',
                  'StellarX',
                  'Aqua (AQUA)',
                  'LOBSTR (LMT)',
                  'BTC (Stellar)',
                  'ETH (Stellar)',
                ].map((asset) => (
                  <div
                    key={asset}
                    className="flex items-center space-x-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-blue-500/30 transition-all duration-200 shadow-sm"
                  >
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-full flex items-center justify-center">
                      <span className="text-blue-400 font-bold text-sm">
                        {asset.slice(0, 2)}
                      </span>
                    </div>
                    <span className="font-medium">{asset}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-semibold mb-6 flex items-center text-[var(--color-text-primary)]">
                <Globe className="w-6 h-6 mr-3 text-green-500" />
                Fiat Currencies
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { code: 'USD', name: 'US Dollar' },
                  { code: 'EUR', name: 'Euro' },
                  { code: 'GBP', name: 'British Pound' },
                  { code: 'NGN', name: 'Nigerian Naira' },
                  { code: 'JPY', name: 'Japanese Yen' },
                  { code: 'CAD', name: 'Canadian Dollar' },
                  { code: 'AUD', name: 'Australian Dollar' },
                  { code: 'CHF', name: 'Swiss Franc' },
                ].map((currency) => (
                  <div
                    key={currency.code}
                    className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-green-500/30 transition-all duration-200 shadow-sm"
                  >
                    <div className="font-medium text-green-600 dark:text-green-400">
                      {currency.code}
                    </div>
                    <div className="text-[var(--color-text-muted)] text-sm">{currency.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 bg-[var(--color-surface-muted)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[var(--color-text-primary)]">Trusted by DeFi Leaders</h2>
            <p className="text-xl text-[var(--color-text-secondary)]">
              Join thousands of satisfied users who trust our platform
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                quote:
                  "The fastest and most reliable crypto-to-fiat solution I've ever used. The AI chat interface makes it incredibly intuitive.",
                author: 'Sarah Chen',
                title: 'DeFi Portfolio Manager',
                rating: 5,
              },
              {
                quote:
                  'Outstanding security features and compliance. Perfect for institutional use with excellent customer support.',
                author: 'Marcus Rodriguez',
                title: 'Crypto Fund Manager',
                rating: 5,
              },
              {
                quote:
                  'Seamless integration with our existing systems. The API is well-documented and the transaction fees are very competitive.',
                author: 'Elena Vasquez',
                title: 'FinTech CTO',
                rating: 5,
              },
            ].map((testimonial, index) => (
              <div
                key={index}
                className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)] shadow-sm"
              >
                <div className="flex items-center mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-5 h-5 text-yellow-400 fill-current"
                    />
                  ))}
                </div>
                <blockquote className="text-[var(--color-text-secondary)] mb-4 italic">
                  &ldquo;{testimonial.quote}&rdquo;
                </blockquote>
                <div>
                  <div className="font-semibold text-[var(--color-text-primary)]">{testimonial.author}</div>
                  <div className="text-[var(--color-text-muted)] text-sm">
                    {testimonial.title}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[var(--color-text-primary)]">Why Choose Our Platform</h2>
            <p className="text-xl text-[var(--color-text-secondary)] max-w-3xl mx-auto">
              Built for the future of finance with cutting-edge blockchain
              technology and enterprise-grade security
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <FeatureCard key={index} {...feature} />
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[var(--color-text-primary)]">
              How Stellar FiatBridge Works
            </h2>
            <p className="text-xl text-[var(--color-text-secondary)]">
              Four simple steps to deposit XLM and convert to fiat seamlessly
            </p>
          </div>

          <div className="space-y-12">
            {steps.map((step, index) => (
              <Step key={index} {...step} />
            ))}
          </div>
        </div>
      </section>

      {/* Early Access Form */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">
            Join the Stellar DeFi Revolution
          </h2>
          <p className="text-xl text-[var(--color-text-secondary)] mb-8">
            Experience the future of XLM-to-fiat finance with our
            Soroban-powered platform
          </p>

          {!isSubmitted ? (
            <form
              onSubmit={handleEmailSubmit}
              className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                className="flex-1 px-4 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-blue-500 transition-colors duration-300"
                required
              />
              <button
                type="submit"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 px-6 py-3 rounded-lg font-semibold transition-all duration-300 hover:scale-105 whitespace-nowrap"
              >
                Launch App
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center space-x-2 text-green-400">
              <CheckCircle className="w-6 h-6" />
              <span className="text-lg">
                Welcome to Stellar DeFi! Launching DeFi Hub...
              </span>
            </div>
          )}

          <p className="text-sm text-[var(--color-text-muted)] mt-4">
            By signing up, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Company Info */}
            <div className="lg:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg"></div>
                <span className="text-xl font-bold">DexFiat</span>
              </div>
              <p className="text-[var(--color-text-muted)] mb-6 leading-relaxed">
                The future of crypto-to-fiat conversion. Secure, fast, and
                compliant with global financial standards.
              </p>
              <div className="flex space-x-4">
                <a
                  href="#"
                  className="text-[var(--color-text-muted)] hover:text-blue-500 transition-colors"
                >
                  <Twitter className="w-5 h-5" />
                </a>
                <a
                  href="#"
                  className="text-[var(--color-text-muted)] hover:text-blue-500 transition-colors"
                >
                  <Github className="w-5 h-5" />
                </a>
                <a
                  href="#"
                  className="text-[var(--color-text-muted)] hover:text-blue-500 transition-colors"
                >
                  <Linkedin className="w-5 h-5" />
                </a>
                <a
                  href="#"
                  className="text-[var(--color-text-muted)] hover:text-blue-500 transition-colors"
                >
                  <MessageSquare className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Platform */}
            <div>
              <h3 className="text-lg font-semibold mb-6">Platform</h3>
              <div className="space-y-3">
                <a
                  href="/chat"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  Convert XLM
                </a>
                <a
                  href="#"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  API Documentation
                </a>
                <a
                  href="#"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  Soroban Contract
                </a>
                <a
                  href="#"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  Fee Structure
                </a>
                <a
                  href="#"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  Status Page
                </a>
              </div>
            </div>

            {/* Resources */}
            <div>
              <h3 className="text-lg font-semibold mb-6">Resources</h3>
              <div className="space-y-3">
                <a
                  href="#"
                  className="flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Documentation
                </a>
                <a
                  href="#"
                  className="flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  <HelpCircle className="w-4 h-4 mr-2" />
                  Help Center
                </a>
                <a
                  href="#"
                  className="flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Community
                </a>
                <a
                  href="#"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  Blog
                </a>
                <a
                  href="#"
                  className="block text-gray-400 hover:text-white transition-colors"
                >
                  Security Audit
                </a>
              </div>
            </div>

            {/* Contact */}
            <div>
              <h3 className="text-lg font-semibold mb-6">Contact</h3>
              <div className="space-y-4">
                <div className="flex items-center text-gray-400">
                  <Mail className="w-4 h-4 mr-3" />
                  <span>support@dexfiat.com</span>
                </div>
                <div className="flex items-center text-gray-400">
                  <Phone className="w-4 h-4 mr-3" />
                  <span>+1 (555) 123-4567</span>
                </div>
                <div className="flex items-start text-gray-400">
                  <MapPin className="w-4 h-4 mr-3 mt-1" />
                  <span>
                    San Francisco, CA
                    <br />
                    United States
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="border-t border-gray-800 mt-12 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6">
                <p className="text-gray-400 text-sm">
                  © 2024 DexFiat. All rights reserved.
                </p>
                <div className="flex space-x-4 text-sm">
                  <a
                    href="#"
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    Privacy Policy
                  </a>
                  <a
                    href="#"
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    Terms of Service
                  </a>
                  <a
                    href="#"
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    Cookie Policy
                  </a>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <span className="text-gray-400 text-sm">Powered by</span>
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 bg-blue-500 rounded-full"></div>
                  <span className="text-sm font-semibold">Stellar Network</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
