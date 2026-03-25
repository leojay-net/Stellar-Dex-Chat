import axios from 'axios';

import type {
  CreateRecipientInput,
  CreateRecipientResult,
  InitiateTransferInput,
  InitiateTransferResult,
  PayoutProvider,
  TransferStatusInput,
  TransferStatusResult,
  CancelTransferInput,
  CancelTransferResult,
  VerifyAccountInput,
  VerifyAccountResult,
} from './types';
import { env } from '@/lib/env';

function paystackHeaders() {
  return {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

export const paystackProvider: PayoutProvider = {
  name: 'paystack',

  async verifyAccount(input: VerifyAccountInput): Promise<VerifyAccountResult> {
    const { accountNumber, bankCode } = input;

    if (!env.PAYSTACK_SECRET_KEY) {
      console.warn('Paystack secret key not found, using mock verification');

      const mockVerification: VerifyAccountResult = {
        account_number: accountNumber,
        account_name: 'John Doe',
        bank_id: Number.parseInt(bankCode, 10),
      };

      await new Promise((resolve) => setTimeout(resolve, 1000));
      return mockVerification;
    }

    const response = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: paystackHeaders() },
    );

    if (response.data?.status && response.data?.data) {
      return {
        account_number: response.data.data.account_number,
        account_name: response.data.data.account_name,
        bank_id: Number.parseInt(bankCode, 10),
      };
    }

    throw new Error(response.data?.message || 'Account verification failed');
  },

  async createRecipient(
    input: CreateRecipientInput,
  ): Promise<CreateRecipientResult> {
    if (!env.PAYSTACK_SECRET_KEY) {
      console.warn(
        'Paystack secret key not found, using mock recipient creation',
      );

      const mockRecipient = {
        active: true,
        createdAt: new Date().toISOString(),
        currency: input.currency,
        domain: 'test',
        id: Math.floor(Math.random() * 1000000),
        integration: 123456,
        name: input.name,
        recipient_code: `RCP_${Math.random().toString(36).substr(2, 9)}`,
        type: input.type,
        updatedAt: new Date().toISOString(),
        is_deleted: false,
        details: {
          authorization_code: null,
          account_number: input.account_number,
          account_name: input.name,
          bank_code: input.bank_code,
          bank_name: 'Mock Bank',
        },
      };

      await new Promise((resolve) => setTimeout(resolve, 1000));
      return mockRecipient;
    }

    const response = await axios.post(
      'https://api.paystack.co/transferrecipient',
      input,
      {
        headers: paystackHeaders(),
      },
    );

    if (response.data?.status && response.data?.data) {
      return response.data.data;
    }

    throw new Error(response.data?.message || 'Failed to create recipient');
  },

  async initiateTransfer(
    input: InitiateTransferInput,
  ): Promise<InitiateTransferResult> {
    if (!env.PAYSTACK_SECRET_KEY) {
      console.warn(
        'Paystack secret key not found, using mock transfer initiation',
      );

      const mockTransfer = {
        reference:
          input.reference ||
          `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        integration: 123456,
        domain: 'test',
        amount: input.amount,
        currency: 'NGN',
        source: input.source,
        reason: input.reason || 'Crypto withdrawal',
        recipient: input.recipient,
        status: 'pending',
        transfer_code: `TRF_${Math.random().toString(36).substr(2, 9)}`,
        id: Math.floor(Math.random() * 1000000),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await new Promise((resolve) => setTimeout(resolve, 1500));
      return mockTransfer;
    }

    const transferData = {
      source: input.source,
      amount: input.amount * 100,
      recipient: input.recipient,
      reason: input.reason || 'Crypto withdrawal',
      reference:
        input.reference ||
        `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    const response = await axios.post(
      'https://api.paystack.co/transfer',
      transferData,
      {
        headers: paystackHeaders(),
      },
    );

    if (response.data?.status && response.data?.data) {
      return response.data.data;
    }

    throw new Error(response.data?.message || 'Failed to initiate transfer');
  },

  async checkTransferStatus(
    input: TransferStatusInput,
  ): Promise<TransferStatusResult> {
    const { reference } = input;

    if (!env.PAYSTACK_SECRET_KEY) {
      console.warn('Paystack secret key not found, using mock transfer status');

      const mockStatus = {
        status: true,
        message: 'Transfer status retrieved (mock)',
        data: {
          reference,
          status: 'pending',
        },
      };

      await new Promise((resolve) => setTimeout(resolve, 700));
      return mockStatus;
    }

    const response = await axios.get(
      `https://api.paystack.co/transfer/verify/${reference}`,
      {
        headers: paystackHeaders(),
      },
    );

    if (response.data?.status && response.data?.data) {
      return response.data.data;
    }

    throw new Error(
      response.data?.message || 'Failed to fetch transfer status',
    );
  },

  async cancelTransfer(input: CancelTransferInput): Promise<CancelTransferResult> {
    const { reference, reason } = input;

    if (!env.PAYSTACK_SECRET_KEY) {
      console.warn('Paystack secret key not found, using mock cancellation');

      // Mock cancellation when API key is missing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const mockCancellation = {
        reference,
        status: 'cancelled',
        cancellationReason: reason || 'User requested cancellation',
        cancelledAt: new Date().toISOString(),
        message: 'Transfer cancelled successfully (mock)',
      };

      return mockCancellation;
    }

    try {
      // First check if transfer can be cancelled (within 2 minutes window)
      const statusResponse = await axios.get(
        `https://api.paystack.co/transfer/verify/${reference}`,
        { headers: paystackHeaders() }
      );

      if (!statusResponse.data?.data) {
        throw new Error('Transfer not found');
      }

      const transferData = statusResponse.data.data;
      const createdAt = new Date(transferData.createdAt);
      const now = new Date();
      const timeDiff = now.getTime() - createdAt.getTime();
      const twoMinutesInMs = 2 * 60 * 1000;

      if (timeDiff > twoMinutesInMs) {
        throw new Error('Transfer can only be cancelled within 2 minutes of initiation');
      }

      if (transferData.status !== 'pending') {
        throw new Error(`Cannot cancel transfer in ${transferData.status} status`);
      }

      // Cancel the transfer
      const response = await axios.post(
        `https://api.paystack.co/transfer/cancel`,
        { reference, reason: reason || 'User requested cancellation' },
        { headers: paystackHeaders() }
      );

      if (response.data?.status && response.data?.data) {
        return {
          ...response.data.data,
          cancelledAt: new Date().toISOString(),
          cancellationReason: reason || 'User requested cancellation',
        };
      }

      throw new Error(response.data?.message || 'Failed to cancel transfer');
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to cancel transfer');
    }
  },
};
