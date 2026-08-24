export interface Property {
  market_value: number | null;
  ownership_share: number;
  usage: "primary_residence" | "rental" | "investment";
  lease_type: "none" | "jeonse" | "monthly" | null;
  deposit: number | null;
  monthly_rent: number | null;
}

export interface Debt {
  balance: number;
}

export interface DerivedMetrics {
  myValue: number;
  totalDebt: number;
  depositLiability: number;
  equity: number;
  investableEquity: number;
  ltv: number | null;
  rentalYield: number | null;
}

export function deriveMetrics(p: Property, debts: Debt[]): DerivedMetrics {
  const myValue = (p.market_value ?? 0) * p.ownership_share;
  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);

  const depositLiability =
    p.usage === "rental" && p.lease_type === "jeonse" ? (p.deposit ?? 0) : 0;

  const equity = myValue - totalDebt - depositLiability;
  const investableEquity = p.usage === "primary_residence" ? 0 : equity;

  const ltv = myValue > 0 ? (totalDebt + depositLiability) / myValue : null;

  const rentalYield =
    p.lease_type === "monthly" && p.monthly_rent != null && myValue > 0
      ? (p.monthly_rent * 12) / (myValue - (p.deposit ?? 0))
      : null;

  return { myValue, totalDebt, depositLiability, equity, investableEquity, ltv, rentalYield };
}
