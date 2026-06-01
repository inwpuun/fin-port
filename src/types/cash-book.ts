export type CashBookFlowType = "income" | "expense";

export type CashBookTransaction = {
  id: string;
  file: string;
  sourceYear: number;
  account: string;
  transferAccount: string;
  description: string;
  rawCategory: string;
  category: string;
  categoryGroup: string;
  date: string;
  dateLabel: string;
  monthKey: string;
  year: number;
  month: number;
  day: number;
  time: string;
  memo: string;
  amount: number;
  currency: string;
  tags: string;
  balance: number | null;
  type: CashBookFlowType;
};
