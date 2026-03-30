import { filterTransactions, FilterState } from "@/lib/transactionFilters";
import { TransactionData } from "@/types";

const mockTransactions: TransactionData[] = [
  {
    id: "1",
    type: "deposit",
    amountIn: "100",
    tokenIn: "XLM",
    timestamp: new Date("2023-10-01").getTime(),
    status: "success",
  },
  {
    id: "2",
    type: "withdrawal",
    amountIn: "500",
    tokenIn: "USDC",
    timestamp: new Date("2023-10-15").getTime(),
    status: "success",
  },
  {
    id: "3",
    type: "deposit",
    amountIn: "1000",
    tokenIn: "XLM",
    timestamp: new Date("2023-11-01").getTime(),
    status: "success",
  },
];

describe("transactionFilters utility", () => {
  const defaultFilters: FilterState = {
    type: "all",
    dateRange: { start: null, end: null },
    amountRange: { min: null, max: null },
  };

  test("should return all transactions when no filters are applied", () => {
    const result = filterTransactions(mockTransactions, defaultFilters);
    expect(result).toHaveLength(3);
  });

  test("should filter by transaction type (deposit)", () => {
    const filters: FilterState = { ...defaultFilters, type: "deposit" };
    const result = filterTransactions(mockTransactions, filters);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.type === "deposit")).toBe(true);
  });

  test("should filter by date range", () => {
    const filters: FilterState = {
      ...defaultFilters,
      dateRange: {
        start: new Date("2023-10-10"),
        end: new Date("2023-10-20"),
      },
    };
    const result = filterTransactions(mockTransactions, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  test("should filter by amount range", () => {
    const filters: FilterState = {
      ...defaultFilters,
      amountRange: { min: 400, max: 600 },
    };
    const result = filterTransactions(mockTransactions, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  test("should apply combined filters", () => {
    const filters: FilterState = {
      type: "deposit",
      amountRange: { min: 500, max: 1500 },
      dateRange: { start: new Date("2023-10-20"), end: null },
    };
    const result = filterTransactions(mockTransactions, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  test("should return empty array when no transactions match criteria", () => {
    const filters: FilterState = {
      ...defaultFilters,
      type: "withdrawal",
      amountRange: { min: 1000 },
    };
    const result = filterTransactions(mockTransactions, filters);
    expect(result).toHaveLength(0);
  });

  test("should handle empty transaction list", () => {
    const result = filterTransactions([], defaultFilters);
    expect(result).toHaveLength(0);
  });
});
