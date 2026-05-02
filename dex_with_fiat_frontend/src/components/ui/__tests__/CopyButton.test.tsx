import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CopyButton from '../CopyButton';

describe('CopyButton', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();

    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });

    document.execCommand = originalExecCommand;
  });

  it('copies with navigator.clipboard and resets copied state after 2 seconds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<CopyButton value="GABC123" successDurationMs={10} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('GABC123');
    });

    await waitFor(() => {
      expect(screen.getByText('Copied!').className).toContain('opacity-100');
    });

    await waitFor(() => {
      expect(screen.getByText('Copied!').className).toContain('opacity-0');
    });
  });

  it('falls back to document.execCommand when clipboard api is unavailable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    const execCommandSpy = vi.fn().mockReturnValue(true);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    document.execCommand = execCommandSpy;

    render(<CopyButton value="CCONTRACT123" successDurationMs={10} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('CCONTRACT123');
      expect(execCommandSpy).toHaveBeenCalledWith('copy');
    });

    await waitFor(() => {
      expect(screen.getByText('Copied!').className).toContain('opacity-100');
    });
  });
});