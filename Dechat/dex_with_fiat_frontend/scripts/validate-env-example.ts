#!/usr/bin/env tsx
/**
 * Validates that .env.example contains all variables declared in
 * src/lib/clientEnv.ts and src/lib/serverEnv.ts schemas.
 *
 * Usage:
 *   pnpm exec tsx scripts/validate-env-example.ts
 *
 * Exit codes:
 *   0 - All schema variables present in .env.example
 *   1 - Missing variables found
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ENV_EXAMPLE_PATH = join(__dirname, '../.env.example');
const CLIENT_ENV_PATH = join(__dirname, '../src/lib/clientEnv.ts');
const SERVER_ENV_PATH = join(__dirname, '../src/lib/serverEnv.ts');

/**
 * Extract variable names from client and server schema definitions
 */
function extractSchemaVariables(): Set<string> {
  const variables = new Set<string>();
  const schemaPattern = /^\s*([A-Z_][A-Z0-9_]*)\s*:/gm;

  for (const path of [CLIENT_ENV_PATH, SERVER_ENV_PATH]) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      let match;
      while ((match = schemaPattern.exec(content)) !== null) {
        variables.add(match[1]);
      }
    }
  }

  return variables;
}

/**
 * Extract non-comment variable names from .env.example
 */
function extractEnvExampleVariables(): Set<string> {
  const envExampleContent = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  const variables = new Set<string>();

  const lines = envExampleContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (trimmed === '') {
      continue;
    }

    // Extract variable name from KEY=value or # KEY=value / # KEY=
    const match = trimmed.match(/^#?\s*([A-Z_][A-Z0-9_]*)=/);
    if (match) {
      variables.add(match[1]);
    }
  }

  return variables;
}

/**
 * Main validation logic
 */
function validateEnvExample(): boolean {
  const schemaVars = extractSchemaVariables();
  const exampleVars = extractEnvExampleVariables();

  // Find variables in schema but not in .env.example
  const missingInExample = [...schemaVars].filter(v => !exampleVars.has(v));

  let isValid = true;

  if (missingInExample.length > 0) {
    console.error('❌ ERROR: Variables declared in schemas but missing from .env.example:');
    missingInExample.forEach(v => console.error(`  - ${v}`));
    isValid = false;
  }

  if (isValid) {
    console.log('✅ SUCCESS: .env.example contains all schema variables');
    console.log(`   Found ${schemaVars.size} schema variables across clientEnv and serverEnv`);
  }

  return isValid;
}

// Run validation
const isValid = validateEnvExample();
process.exit(isValid ? 0 : 1);
