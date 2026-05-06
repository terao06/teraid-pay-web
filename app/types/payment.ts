export type Pay = {
  payment_request_id: number;
  from_wallet_address: string;
  to_wallet_address: string;
  amount: number;
  chain_id: number;
};

export type ExecutePay = {
  payment_request_id: number;
  transaction_hash: string;
};

export type VerifyStatus = "requested" | "submitted" | "confirming" | "paid" | "tx_failed" | "verify_failed" | "canceled" | "error";

export type Toast = {
  kind: "success" | "error";
  title: string;
  text: string;
  amount?: number;
};
