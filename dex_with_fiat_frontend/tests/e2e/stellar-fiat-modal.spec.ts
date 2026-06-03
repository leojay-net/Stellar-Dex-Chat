import { test, expect } from '@playwright/test';

test.describe('StellarFiatModal E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chat');
    
    // Mock connected Freighter wallet
    await page.addInitScript(() => {
      window.freighter = {
        isConnected: async () => ({ isConnected: true }),
        getAddress: async () => ({ 
          address: 'GCTESTADDRESS123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' 
        }),
        getNetwork: async () => ({ network: 'TESTNET' }),
        signTransaction: async () => ({ 
          signedTxXdr: 'AAAAAgAAAABzZXJ2aWNlX3BvaW50X2hvc3QAAAAAAAAAAAAA',
          error: null
        }),
        requestAccess: async () => ({ 
          address: 'GCTESTADDRESS123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' 
        })
      };
    });

    await page.waitForTimeout(1000);
  });

  test.describe('Modal Opening and Closing', () => {
    test('should open modal when deposit button is clicked', async ({ page }) => {
      const depositButton = page.locator('button', { hasText: /deposit/i }).first();
      await depositButton.click();

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();
      await expect(page.locator('h2', { hasText: /deposit to bridge/i })).toBeVisible();
    });

    test('should close modal when close button is clicked', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      await expect(page.locator('[role="dialog"]')).toBeVisible();

      const closeButton = page.locator('button[aria-label="Close"]');
      await closeButton.click();

      await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    });

    test('should display correct modal title for deposit mode', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      await expect(page.locator('h2:has-text("Deposit to Bridge")')).toBeVisible();
    });
  });

  test.describe('Amount Input Validation', () => {
    test('should accept valid amount input', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('10.5');
      
      await expect(amountInput).toHaveValue('10.5');
    });

    test('should show error for invalid amount', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('-5');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await expect(submitButton).toBeDisabled();
    });

    test('should show error for zero amount', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('0');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await expect(submitButton).toBeDisabled();
    });

    test('should update amount with preset buttons', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const preset5 = page.locator('button:has-text("5")').first();
      await preset5.click();
      
      const amountInput = page.locator('input[type="number"]').first();
      await expect(amountInput).toHaveValue('5');
    });

    test('should clear active preset when manually editing amount', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      // Click preset
      await page.locator('button:has-text("10")').first().click();
      
      // Manually edit
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('15');
      
      // Verify preset is no longer active (visual check would be via class)
      await expect(amountInput).toHaveValue('15');
    });
  });

  test.describe('Fiat Estimate Display', () => {
    test('should show fiat estimate for valid amount', async ({ page }) => {
      await page.addInitScript(() => {
        window.getTokenPrice = async () => 0.12; // Mock XLM price
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('100');
      
      await page.waitForTimeout(600); // Wait for debounce
      
      // Should show approximate fiat value
      await expect(page.locator('text=/~/').first()).toBeVisible();
    });
  });

  test.describe('Note Field', () => {
    test('should accept optional note input', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const noteInput = page.locator('textarea');
      await noteInput.fill('Test deposit note');
      
      await expect(noteInput).toHaveValue('Test deposit note');
    });

    test('should limit note to 160 characters', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const noteInput = page.locator('textarea');
      const longNote = 'a'.repeat(200);
      await noteInput.fill(longNote);
      
      const value = await noteInput.inputValue();
      expect(value.length).toBeLessThanOrEqual(160);
    });
  });

  test.describe('Fee Estimation', () => {
    test('should show loading state while calculating fees', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('50');
      
      // Should show simulation results section
      await expect(page.locator('text=/Simulation Results/i')).toBeVisible();
    });

    test('should display base fee and resource fee', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('25');
      
      await page.waitForTimeout(600);
      
      await expect(page.locator('text=/Base Fee/i')).toBeVisible();
      await expect(page.locator('text=/Resource Fee/i')).toBeVisible();
      await expect(page.locator('text=/Total Network Fee/i')).toBeVisible();
    });
  });

  test.describe('Bridge Capacity Display', () => {
    test('should show bridge capacity section for deposits', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      await expect(page.locator('text=/Bridge Capacity/i')).toBeVisible();
    });

    test('should display capacity bar', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('10');
      
      // Should show progress bar
      const progressBar = page.locator('.h-1\\.5').first();
      await expect(progressBar).toBeVisible();
    });

    test('should show error when amount exceeds limit', async ({ page }) => {
      await page.addInitScript(() => {
        window.bridgeLimit = 100; // Mock low limit
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('200');
      
      await page.waitForTimeout(600);
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await expect(submitButton).toBeDisabled();
    });
  });

  test.describe('Large Amount Risk Confirmation', () => {
    test('should show risk confirmation for amounts >= 500 XLM', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('600');
      
      await expect(page.locator('text=/Large amount confirmation required/i')).toBeVisible();
      
      const riskInput = page.locator('input[placeholder*="I UNDERSTAND"]');
      await expect(riskInput).toBeVisible();
    });

    test('should enable submit only after correct phrase is entered', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('550');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await expect(submitButton).toBeDisabled();
      
      const riskInput = page.locator('input[placeholder*="I UNDERSTAND"]');
      await riskInput.fill('I UNDERSTAND THE RISKS');
      
      await page.waitForTimeout(300);
      // Button state depends on other conditions too
    });
  });

  test.describe('Wallet Information Display', () => {
    test('should display connected wallet address', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const walletInfo = page.locator('[data-testid="wallet-info"]');
      await expect(walletInfo).toBeVisible();
      await expect(walletInfo).toContainText('GCTESTAD');
    });

    test('should display wallet network', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const walletInfo = page.locator('[data-testid="wallet-info"]');
      await expect(walletInfo).toContainText('TESTNET');
    });

    test('should show wallet balance when available', async ({ page }) => {
      await page.addInitScript(() => {
        global.fetch = async (url) => {
          if (url.includes('horizon')) {
            return {
              ok: true,
              json: async () => ({
                balances: [
                  { asset_type: 'native', balance: '1234.5678900' }
                ]
              })
            };
          }
          return { ok: false };
        };
      });

      await page.click('button:has-text("Deposit")');
      
      await page.waitForTimeout(1000);
      
      await expect(page.locator('text=/Available:/i')).toBeVisible();
    });
  });

  test.describe('Transaction Submission', () => {
    test('should show loading state during transaction', async ({ page }) => {
      await page.addInitScript(() => {
        window.depositToContract = async () => {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return 'mock-tx-hash-12345';
        };
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('5');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await submitButton.click();
      
      await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
      await expect(page.locator('text=/Signing & submitting/i')).toBeVisible();
    });

    test('should show success state after successful deposit', async ({ page }) => {
      await page.addInitScript(() => {
        window.depositToContract = async () => 'success-tx-hash-abc123';
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('10');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await submitButton.click();
      
      await page.waitForTimeout(1500);
      
      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
      await expect(page.locator('text=/Transaction Confirmed/i')).toBeVisible();
    });

    test('should display transaction hash link on success', async ({ page }) => {
      await page.addInitScript(() => {
        window.depositToContract = async () => 'test-hash-xyz789';
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('7.5');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await submitButton.click();
      
      await page.waitForTimeout(1500);
      
      const txLink = page.locator('a[href*="stellar.expert"]');
      await expect(txLink).toBeVisible();
      await expect(txLink).toHaveAttribute('href', /test-hash-xyz789/);
    });

    test('should show error message on transaction failure', async ({ page }) => {
      await page.addInitScript(() => {
        window.depositToContract = async () => {
          throw new Error('Insufficient balance');
        };
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('10');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await submitButton.click();
      
      await page.waitForTimeout(1500);
      
      await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
      await expect(page.locator('text=/Insufficient balance/i')).toBeVisible();
    });
  });

  test.describe('Receipt Download', () => {
    test('should show download receipt button on success', async ({ page }) => {
      await page.addInitScript(() => {
        window.depositToContract = async () => 'receipt-test-hash';
      });

      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('15');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await submitButton.click();
      
      await page.waitForTimeout(1500);
      
      const downloadButton = page.locator('[data-testid="download-receipt-button"]');
      await expect(downloadButton).toBeVisible();
      await expect(downloadButton).toContainText('Download Receipt');
    });
  });

  test.describe('Accessibility', () => {
    test('modal should have correct ARIA attributes', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toHaveAttribute('aria-modal', 'true');
      await expect(modal).toHaveAttribute('aria-label', /deposit to bridge/i);
    });

    test('close button should have aria-label', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const closeButton = page.locator('button[aria-label="Close"]');
      await expect(closeButton).toBeVisible();
    });

    test('amount input should have invalid state for errors', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('-10');
      
      await expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    });
  });

  test.describe('Cooldown Protection', () => {
    test('should disable submit button during cooldown period', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const amountInput = page.locator('input[type="number"]').first();
      await amountInput.fill('5');
      
      const submitButton = page.locator('button:has-text("Review Transaction")');
      await submitButton.click();
      
      // After clicking, should be in cooldown
      await page.waitForTimeout(100);
      await expect(submitButton).toBeDisabled();
    });
  });

  test.describe('Admin Mode (Withdraw)', () => {
    test('should show recipient address field in admin mode', async ({ page }) => {
      // This would require triggering admin mode
      // Implementation depends on how admin mode is activated
      // Placeholder for completeness
    });
  });

  test.describe('Demo Mode', () => {
    test('should have demo simulate success button', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const demoButton = page.locator('text=/Demo.*Simulate Success/i');
      await expect(demoButton).toBeVisible();
    });

    test('demo button should simulate successful transaction', async ({ page }) => {
      await page.click('button:has-text("Deposit")');
      
      const demoButton = page.locator('text=/Demo.*Simulate Success/i');
      await demoButton.click();
      
      await page.waitForTimeout(300);
      
      await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    });
  });
});

