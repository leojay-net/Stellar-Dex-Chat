import { expect, test as base } from '@playwright/test';

export const test = base.extend<{ checkCsp: void }>({
  checkCsp: [
    async ({ context }, use) => {
      const violations: string[] = [];
      await context.exposeBinding(
        '__recordCspViolation',
        ({ frame }, directive: string, blockedUri: string) => {
          violations.push(`${frame.url()} | ${directive} | ${blockedUri}`);
        },
      );
      await context.addInitScript(() => {
        const browserWindow = window as typeof window & {
          __recordCspViolation: (
            directive: string,
            blockedUri: string,
          ) => Promise<void>;
        };
        document.addEventListener('securitypolicyviolation', (event) => {
          void browserWindow.__recordCspViolation(
            event.effectiveDirective,
            event.blockedURI,
          );
        });
      });

      await use();

      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
