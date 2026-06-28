"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PaymentForm } from "@/app/components/PaymentForm";
import { PaymentResultDialog } from "@/app/components/PaymentResultDialog";
import { ProcessingOverlay } from "@/app/components/ProcessingOverlay";
import type { PaymentCreateRequest, PaymentTransactionHash, PaymentVerify, SuccessResponse, Toast, VerifyStatus } from "@/app/types/payment";

const api = process.env.NEXT_PUBLIC_TERAID_PAY_API ?? "http://localhost:8005";
const done = new Set<VerifyStatus>(["paid", "tx_failed", "verify_failed", "canceled", "error"]);
const toastDurationMs = 3000;

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiErrorMessage(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "detail" in body &&
    typeof body.detail === "object" &&
    body.detail !== null &&
    "message" in body.detail &&
    typeof body.detail.message === "string"
  ) {
    return body.detail.message;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [toast, setToast] = useState<Toast>();
  const [processing, setProcessing] = useState(false);
  const cancelled = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      clearTimeout(toastTimer.current);
    };
  }, []);

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = getApiErrorMessage(body);
      if (message) throw new ApiError(message);
      throw Error(`HTTP ${res.status}`);
    }
    return body;
  }

  function showToast(next: Toast) {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(undefined), toastDurationMs);
  }

  async function pollUntilDone(id: number) {
    while (!cancelled.current) {
      const { data } = await json<SuccessResponse<PaymentVerify>>(`/payment/request/${id}/verify`, { method: "POST" });
      if (done.has(data.status)) return data.status;
      await sleep(3000);
    }
    throw Error("cancelled");
  }

  async function submit(e: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    e.preventDefault();
    setProcessing(true);
    setToast(undefined);

    try {
      const f = new FormData(e.currentTarget);
      const body: PaymentCreateRequest = {
        store_id: Number(f.get("store_id")),
        user_id: Number(f.get("user_id")),
        amount: Number(f.get("amount")),
      };
      const { data: pay } = await json<SuccessResponse<PaymentTransactionHash>>("/payment/request", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const status = await pollUntilDone(pay.payment_request_id);
      showToast(
        status === "paid"
          ? { kind: "success", title: "決済完了", text: "ありがとうございました", amount: body.amount }
          : { kind: "error", title: "決済に失敗しました", text: "支払い処理を完了できませんでした。" },
      );
    } catch (error) {
      if (!cancelled.current) {
        showToast({
          kind: "error",
          title: error instanceof ApiError ? error.message : "決済に失敗しました",
          text: error instanceof ApiError ? undefined : "支払い処理を完了できませんでした。",
        });
      }
    } finally {
      if (!cancelled.current) setProcessing(false);
    }
  }

  return (
    <main className="min-h-dvh bg-zinc-950 px-4 py-10 text-zinc-100">
      {processing && <ProcessingOverlay />}
      {toast && <PaymentResultDialog toast={toast} durationMs={toastDurationMs} />}

      <section className="mx-auto grid max-w-3xl gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Teraid Pay</h1>
          <Link href="/face-payment" className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
            顔認証決済へ
          </Link>
        </div>
        <PaymentForm processing={processing} onSubmit={submit} />
      </section>
    </main>
  );
}
