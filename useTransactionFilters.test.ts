import { renderHook, act } from "@testing-library/react";
import { useTransactionFilters } from "@/hooks/useTransactionFilters";
import { TransactionData } from "@/types";

const mockTransactions: TransactionData[] = [
  {
    id: "1",
    type: "deposit",
    amountIn: "100",
    tokenIn: "XLM",
    timestamp: Date.now(),
    status: "success",
  },
  {
    id: "2",
    type: "withdrawal",
    amountIn: "500",
    tokenIn: "USDC",
    timestamp: Date.now(),
    status: "success",
  },
];

describe("useTransactionFilters hook", () => {
  it("should initialize with provided transactions and default filters", () => {
    const { result } = renderHook(() =>
      useTransactionFilters(mockTransactions)
    );

    expect(result.current.filteredTransactions).toHaveLength(2);
    expect(result.current.filters.type).toBe("all");
  });

  it("should update filtered transactions when setFilters is called", () => {
    const { result } = renderHook(() =>
      useTransactionFilters(mockTransactions)
    );

    act(() => {
      result.current.setFilters({ type: "deposit" });
    });

    expect(result.current.filteredTransactions).toHaveLength(1);
    expect(result.current.filteredTransactions[0].type).toBe("deposit");
    expect(result.current.filters.type).toBe("deposit");
  });

  it("should clear all filters back to default state", () => {
    const { result } = renderHook(() =>
      useTransactionFilters(mockTransactions)
    );

    act(() => {
      result.current.setFilters({
        type: "withdrawal",
        amountRange: { min: 1000, max: 2000 },
      });
    });

    expect(result.current.filteredTransactions).toHaveLength(0);

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.filteredTransactions).toHaveLength(2);
    expect(result.current.filters.type).toBe("all");
    expect(result.current.filters.amountRange.min).toBeNull();
    expect(result.current.filters.amountRange.max).toBeNull();
  });
});
