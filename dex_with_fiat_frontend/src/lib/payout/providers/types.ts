export type PayoutProviderName = 'paystack';

export interface VerifyAccountInput {
  accountNumber: string;
  bankCode: string;
}

export interface VerifyAccountResult {
  account_number: string;
  account_name: string;
  bank_id: number;
}

export interface CreateRecipientInput {
  type: string;
  name: string;
  account_number: string;
  bank_code: string;
  currency: string;
}

export type CreateRecipientResult = Record<string, unknown>;

export interface InitiateTransferInput {
  source: string;
  reason?: string;
  amount: number;
  recipient: string;
  reference?: string;
}

export type InitiateTransferResult = Record<string, unknown>;

export interface TransferStatusInput {
  reference: string;
}

export type TransferStatusResult = Record<string, unknown>;

export interface CancelTransferInput {
  reference: string;
  reason?: string;
}

export type CancelTransferResult = Record<string, unknown>;

export interface PayoutProvider {
  name: PayoutProviderName;

  verifyAccount(input: VerifyAccountInput): Promise<VerifyAccountResult>;
  createRecipient(input: CreateRecipientInput): Promise<CreateRecipientResult>;
  initiateTransfer(
    input: InitiateTransferInput,
  ): Promise<InitiateTransferResult>;
  checkTransferStatus(
    input: TransferStatusInput,
  ): Promise<TransferStatusResult>;
  cancelTransfer(
    input: CancelTransferInput,
  ): Promise<CancelTransferResult>;
}
