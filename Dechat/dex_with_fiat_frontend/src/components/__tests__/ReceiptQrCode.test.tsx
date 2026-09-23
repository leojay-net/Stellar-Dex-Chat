import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ReceiptQrCode from '../ReceiptQrCode';

let mockToDataURL: ReturnType<typeof vi.fn>;

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(),
  },
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

describe('ReceiptQrCode', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const qrcode = await import('qrcode');
    mockToDataURL = qrcode.default.toDataURL as unknown as ReturnType<typeof vi.fn>;
    mockToDataURL.mockResolvedValue('data:image/png;base64,qr');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an accessible QR placeholder while the code is generating', async () => {
    mockToDataURL.mockImplementation(() => new Promise(() => {}));

    render(<ReceiptQrCode value="abc" label="Verify transaction" />);

    expect(screen.getByRole('status')).toHaveTextContent('Generating QR code…');
  });

  it('renders the generated QR code image once the data URL is ready', async () => {
    render(<ReceiptQrCode value="abc" label="Verify transaction" />);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Verify transaction' })).toBeInTheDocument();
    });
  });
});
