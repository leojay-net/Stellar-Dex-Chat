/**
 * Centralized environment variable validation with fail-fast error handling
 * and safe defaults for optional variables.
 */

interface EnvSchema {
  // Required secrets - will fail fast if missing
  PAYSTACK_SECRET_KEY: string;
  NEXT_PUBLIC_GEMINI_API_KEY: string;
  
  // Optional public variables with safe defaults
  NEXT_PUBLIC_STELLAR_RPC_URL: string;
  NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT: string;
  NEXT_PUBLIC_XLM_SAC_CONTRACT: string;
  
  // Optional development/feature flags
  NODE_ENV: 'development' | 'production' | 'test';
  NEXT_PUBLIC_ENABLE_TELEMETRY: string;
  NEXT_PUBLIC_LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Validates environment variables and provides safe defaults
 * Throws descriptive errors for missing required variables
 */
function validateEnv(): EnvSchema {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required secrets
  const requiredVars = [
    'PAYSTACK_SECRET_KEY',
    'NEXT_PUBLIC_GEMINI_API_KEY',
  ];

  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value) {
      errors.push(`❌ Missing required environment variable: ${varName}`);
    } else if (value.length < 10) {
      errors.push(`❌ Invalid ${varName}: appears to be too short to be valid`);
    }
  }

  // Validate optional variables with defaults
  const env: Partial<EnvSchema> = {};

  // Stellar RPC URL
  env.NEXT_PUBLIC_STELLAR_RPC_URL = 
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL || 
    'https://soroban-testnet.stellar.org';

  if (process.env.NEXT_PUBLIC_STELLAR_RPC_URL && 
      !process.env.NEXT_PUBLIC_STELLAR_RPC_URL.startsWith('http')) {
    warnings.push(`⚠️  NEXT_PUBLIC_STELLAR_RPC_URL should start with http/https`);
  }

  // Fiat Bridge Contract
  env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT = 
    process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT || 
    'CAWYXBN4PSVXD7NIYEWVFFIIIEUCC6PUN3IMG3J2WHKDB4NVIISMXBPR';

  if (process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT && 
      process.env.NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT.length !== 56) {
    warnings.push(`⚠️  NEXT_PUBLIC_FIAT_BRIDGE_CONTRACT should be 56 characters (Stellar contract address)`);
  }

  // XLM SAC Contract
  env.NEXT_PUBLIC_XLM_SAC_CONTRACT = 
    process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT || 
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

  if (process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT && 
      process.env.NEXT_PUBLIC_XLM_SAC_CONTRACT.length !== 56) {
    warnings.push(`⚠️  NEXT_PUBLIC_XLM_SAC_CONTRACT should be 56 characters (Stellar contract address)`);
  }

  // Node environment
  env.NODE_ENV = (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development';

  // Feature flags
  env.NEXT_PUBLIC_ENABLE_TELEMETRY = process.env.NEXT_PUBLIC_ENABLE_TELEMETRY || 'true';
  env.NEXT_PUBLIC_LOG_LEVEL = (process.env.NEXT_PUBLIC_LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || 'info';

  // Assign required vars if they exist
  env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
  env.NEXT_PUBLIC_GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY!;

  // Fail fast for critical errors
  if (errors.length > 0) {
    const errorMessage = [
      '\n🚨 Environment Validation Failed:',
      ...errors,
      '\n💡 To fix:',
      '1. Copy .env.example to .env.local',
      '2. Add the missing environment variables',
      '3. Restart the development server',
      '\n📖 For more help, check the documentation.'
    ].join('\n');
    
    throw new Error(errorMessage);
  }

  // Show warnings in development
  if (warnings.length > 0 && env.NODE_ENV === 'development') {
    console.warn('\n⚠️  Environment Warnings:');
    warnings.forEach(warning => console.warn(warning));
    console.warn('');
  }

  return env as EnvSchema;
}

/**
 * Cached validated environment variables
 */
let _env: EnvSchema | null = null;

/**
 * Get validated environment variables
 * Validates once and caches the result for performance
 */
export function getEnv(): EnvSchema {
  if (!_env) {
    _env = validateEnv();
  }
  return _env;
}

/**
 * Re-validate environment variables (useful for testing)
 */
export function revalidateEnv(): EnvSchema {
  _env = null;
  return getEnv();
}

/**
 * Type-safe environment variable access
 */
export const env = getEnv();

/**
 * Runtime environment checks
 */
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Feature flags
 */
export const telemetryEnabled = env.NEXT_PUBLIC_ENABLE_TELEMETRY === 'true';
export const logLevel = env.NEXT_PUBLIC_LOG_LEVEL;
