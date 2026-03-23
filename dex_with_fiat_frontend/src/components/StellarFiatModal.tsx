"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowDownUp,
} from "lucide-react";
import { useStellarWallet } from "@/contexts/StellarWalletContext";
import {
  depositToContract,
  withdrawFromContract,
  stroopsToDisplay,
} from "@/lib/stellarContract";
import SkeletonPayout from "@/components/ui/skeleton/SkeletonPayout";

interface StellarFiatModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAmount?: string;
  isAdminMode?: boolean;
  recipientAddress?: string;
}

type TxStatus = "idle" | "loading" | "success" | "error";

export default function StellarFiatModal({
  isOpen,
  onClose,
  defaultAmount = "",
  isAdminMode = false,
  recipientAddress = "",
}: StellarFiatModalProps) {
  const { connection, signTx } = useStellarWallet();

  const [amount, setAmount] = useState(defaultAmount);
  const [recipient, setRecipient] = useState(recipientAddress);
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoadingUI, setIsLoadingUI] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingUI(true);
      const timer = setTimeout(() => setIsLoadingUI(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const stroopsAmount = BigInt(Math.floor(parseFloat(amount || "0") * 1e7));

  const handleAction = async () => {
    if (!connection.isConnected) return;
    if (!amount || stroopsAmount <= BigInt(0)) {
      setErrorMsg("Please enter a valid amount.");
      return;
    }

    setStatus("loading");
    setErrorMsg("");
    try {
      let hash: string;
      if (isAdminMode) {
        const to = recipient || connection.publicKey;
        hash = await withdrawFromContract(
          connection.publicKey,
          to,
          stroopsAmount,
          signTx,
        );
      } else {
        hash = await depositToContract(
          connection.publicKey,
          stroopsAmount,
          signTx,
        );
      }
      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Transaction failed");
      setStatus("error");
    }
  };

  const handleClose = () => {
    setStatus("idle");
    setTxHash("");
    setErrorMsg("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <ArrowDownUp className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">
              {isAdminMode ? "Withdraw from Bridge" : "Deposit to Bridge"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {status === "success" ? (
          <div className="text-center py-6">
            <CheckCircle className="w-14 h-14 text-green-400 mx-auto mb-4" />
            <p className="text-white font-semibold text-lg mb-2">
              Transaction Confirmed!
            </p>
            <p className="text-gray-400 text-sm mb-4">
              {isAdminMode ? "Withdrawal" : "Deposit"} of{" "}
              <span className="text-white font-medium">
                {stroopsToDisplay(stroopsAmount)} XLM
              </span>{" "}
              processed successfully.
            </p>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline text-xs break-all"
            >
              {txHash}
            </a>
            <button
              onClick={handleClose}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        ) : isLoadingUI ? (
          <SkeletonPayout />
        ) : (
          <>
            {/* Amount input */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">
                Amount (XLM)
              </label>
              <input
                type="number"
                min="0"
                step="0.0000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Recipient */}
            {isAdminMode && (
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-1">
                  Recipient address (leave blank for self)
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="G..."
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
                />
              </div>
            )}

            {/* Info */}
            <div className="flex justify-between text-xs text-gray-500 mb-6">
              <span>
                Connected: {connection.address.slice(0, 8)}…
                {connection.address.slice(-4)}
              </span>
              <span>Network: {connection.network || "TESTNET"}</span>
            </div>

            {/* Error */}
            {status === "error" && (
              <div className="flex items-center gap-2 text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mb-4 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* CTA */}
            <button
              onClick={handleAction}
              disabled={status === "loading" || !connection.isConnected}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-all"
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing & submitting…
                </>
              ) : isAdminMode ? (
                "Withdraw"
              ) : (
                "Deposit"
              )}
            </button>

            {!connection.isConnected && (
              <p className="text-center text-xs text-gray-500 mt-3">
                Connect your Freighter wallet to continue.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
