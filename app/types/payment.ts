export type PaymentCreateRequest = {
  store_id: number;
  user_id: number;
  amount: number;
};

export type PaymentCreateFromFaceRequest = {
  store_id: number;
  content: string;
  amount: number;
};

export type PaymentTransactionHash = {
  payment_request_id: number;
  transaction_hash: string;
};

export type VerifyStatus = "requested" | "submitted" | "confirming" | "paid" | "tx_failed" | "verify_failed" | "canceled" | "error";

export type PaymentVerify = {
  payment_request_id: number;
  status: VerifyStatus;
};

export type SuccessResponse<T> = {
  status: "success";
  data: T;
};

export type Toast = {
  kind: "success" | "error";
  title: string;
  text: string;
  amount?: number;
};
