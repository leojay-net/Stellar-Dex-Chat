import { jsPDF } from 'jspdf';
import { ChatMessage } from '@/types';

export interface ReceiptData {
  txHash: string;
  amount: string;
  wallet: string;
  network: string;
  timestamp: string;
  type: 'Deposit' | 'Withdrawal';
  note?: string;
  messages?: ChatMessage[];
}

export function downloadReceipt(data: ReceiptData): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let cursorY = 20;

  // --- Header ---
  doc.setFontSize(22);
  doc.setTextColor(40, 44, 52);
  doc.text('Stellar Dex Bridge', margin, cursorY);
  cursorY += 10;

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Transaction Receipt', margin, cursorY);
  cursorY += 15;

  // --- Transaction Summary Box ---
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 65, 3, 3, 'FD');

  cursorY += 10;
  doc.setFontSize(12);
  doc.setTextColor(40, 44, 52);
  doc.setFont('helvetica', 'bold');
  doc.text('Transaction Details', margin + 5, cursorY);
  cursorY += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const drawRow = (label: string, value: string) => {
    doc.setTextColor(100, 100, 100);
    doc.text(label, margin + 5, cursorY);
    doc.setTextColor(40, 44, 52);

    // Handle long values like hashes
    const splitValue = doc.splitTextToSize(value, pageWidth - margin * 2 - 40);
    doc.text(splitValue, margin + 40, cursorY);
    cursorY += splitValue.length * 5;
  };

  drawRow('Type:', data.type);
  drawRow('Amount:', `${data.amount} XLM`);
  drawRow('Network:', data.network);
  drawRow('Wallet:', data.wallet);
  drawRow('Tx Hash:', data.txHash);
  drawRow('Date:', data.timestamp);

  if (data.note) {
    drawRow('Note:', data.note);
  }

  cursorY += 10;

  // --- Chat Transcript Section ---
  if (data.messages && data.messages.length > 0) {
    // Check if we need a new page for the transcript header
    if (cursorY > 230) {
      doc.addPage();
      cursorY = 20;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Conversation Context', margin, cursorY);
    cursorY += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    for (const msg of data.messages) {
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
      const text = `${role}: ${msg.content}`;
      const splitText = doc.splitTextToSize(text, pageWidth - margin * 2);

      // Page break check
      if (cursorY + splitText.length * 4 > 270) {
        doc.addPage();
        cursorY = 20;
      }

      if (msg.role === 'user') {
        doc.setTextColor(0, 102, 204);
      } else {
        doc.setTextColor(40, 44, 52);
      }
      doc.text(splitText, margin, cursorY);
      cursorY += splitText.length * 5;
    }
  }

  // --- Footer ---
  cursorY = 280; // Try to put at the bottom
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(
    'This receipt was generated on the client as evidence of the transaction context.',
    margin,
    cursorY,
  );
  doc.text(
    'Explorer: https://stellar.expert/explorer/testnet/tx/' + data.txHash,
    margin,
    cursorY + 4,
  );

  doc.save(`stellar-receipt-${data.txHash.slice(0, 8)}.pdf`);
}
