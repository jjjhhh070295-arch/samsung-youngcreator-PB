import { requireTraderDb, DbUnavailableError } from "./client";

export type OrderStatus =
  | "SIGNAL_CREATED"
  | "ORDER_SUBMITTING"
  | "ORDER_ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

export interface OrderRow {
  id: string;
  idempotency_key: string;
  trading_day: string;
  ticker: string;
  side: "buy" | "sell";
  signal_kind: string;
  strategy_version: string;
  quantity: number;
  price: number;
  exchange_requested: string;
  exchange_effective: string;
  ord_dvsn: string;
  status: OrderStatus;
  kis_order_no?: string | null;
  filled_quantity: number;
}

export async function insertOrderIfNew(row: Omit<OrderRow, "id" | "filled_quantity"> & { filled_quantity?: number }): Promise<{ created: boolean; order: OrderRow | null }> {
  const db = requireTraderDb();
  const { data: existing } = await db
    .from("trading_orders")
    .select("*")
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle();
  if (existing) return { created: false, order: existing as OrderRow };

  const { data, error } = await db.from("trading_orders").insert({
    ...row,
    filled_quantity: row.filled_quantity ?? 0,
  }).select("*").single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await db.from("trading_orders").select("*").eq("idempotency_key", row.idempotency_key).maybeSingle();
      return { created: false, order: (again as OrderRow) ?? null };
    }
    throw error;
  }
  return { created: true, order: data as OrderRow };
}

export async function updateOrderStatus(id: string, patch: Partial<OrderRow> & { error?: string | null }): Promise<void> {
  const db = requireTraderDb();
  const { error } = await db.from("trading_orders").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function listOpenOrders(): Promise<OrderRow[]> {
  const db = requireTraderDb();
  const { data, error } = await db
    .from("trading_orders")
    .select("*")
    .in("status", ["SIGNAL_CREATED", "ORDER_SUBMITTING", "ORDER_ACCEPTED", "PARTIALLY_FILLED", "RECONCILIATION_REQUIRED"]);
  if (error) throw error;
  return (data ?? []) as OrderRow[];
}

export { DbUnavailableError };
