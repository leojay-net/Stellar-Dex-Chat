import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';

vi.mock('@sentry/nextjs', () => ({
  withSentryConfig: (config: unknown) => config,
}));

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Explorer links open in the browser or appear in exported receipts and fixtures.
const navigationOrigins: Record<string, string> = {
  'app/(e2e)/test-ccip-bridge-modal/page.tsx': 'https://ccip.chain.link',
  'app/(e2e)/test-message/page.tsx': 'https://example.com',
  'components/LandingPage.tsx': 'https://stellar.expert',
  'components/ReceiptDrawer.tsx': 'https://stellar.expert',
  'components/StellarFiatModal.tsx': 'https://stellar.expert',
  'lib/aiAssistant.ts': 'https://stellar.expert',
  'lib/ccipExplorer.ts': 'https://ccip.chain.link',
  'lib/receipt.ts': 'https://stellar.expert',
};

function connectionSources(file: string): Set<string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(sourceRoot, file), 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const origins = new Set<string>();
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const [origin] of node.text.matchAll(
        /(?:https?|wss?):\/\/[a-z0-9.-]+(?::\d+)?/gi,
      )) {
        if (origin !== navigationOrigins[file]) origins.add(origin);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return origins;
}

function matchesSource(origin: string, source: string): boolean {
  if (origin === source) return true;
  const wildcard = /^(https?|wss?):\/\/\*\.(.+)$/.exec(source);
  if (!wildcard) return false;
  const url = new URL(origin);
  return (
    url.protocol === wildcard[1] + ':' && url.host.endsWith('.' + wildcard[2])
  );
}

it('allows every literal browser connection origin in connect-src', async () => {
  const headers = await nextConfig.headers?.();
  const policy = headers
    ?.find((entry) => entry.source === '/:path*')
    ?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
  const sources = policy
    ?.split('; ')
    .find((directive) => directive.startsWith('connect-src '))
    ?.split(' ')
    .slice(1);
  expect(sources).toContain("'self'");

  const missing: string[] = [];
  for (const entry of readdirSync(sourceRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const file = relative(
      sourceRoot,
      join(entry.parentPath, entry.name),
    ).replaceAll('\\', '/');
    if (
      /\.(test|spec|d)\.[cm]?[jt]sx?$/.test(file) ||
      file.includes('/__tests__/') ||
      file.startsWith('app/api/') ||
      file.startsWith('lib/payout/providers/')
    )
      continue;
    for (const origin of connectionSources(file)) {
      if (!sources?.some((source) => matchesSource(origin, source))) {
        missing.push(file + ' | ' + origin);
      }
    }
  }
  expect(missing.sort()).toEqual([]);
});
