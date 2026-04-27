"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Pay = {
  payment_request_id: number;
  from_wallet_address: string;
  to_wallet_address: string;
  amount: number;
  chain_id: number;
};
type VerifyStatus = "requested" | "submitted" | "confirming" | "paid" | "tx_failed" | "verify_failed" | "canceled" | "error";
type Toast = { kind: "success" | "error"; title: string; text: string };
type Eth = { request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T> };

declare global {
  interface Window {
    ethereum?: Eth;
  }
}

const api = process.env.NEXT_PUBLIC_TERAID_PAY_API ?? "http://localhost:8005";
const token = process.env.NEXT_PUBLIC_JPYC_TOKEN_ADDRESS_ETHEREUM_SEPOLIA ?? "";
const decimals = Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS ?? 18);
const done = new Set<VerifyStatus>(["paid", "tx_failed", "verify_failed", "canceled", "error"]);

function unit(n: number) {
  return "0x" + (BigInt(n) * BigInt(10) ** BigInt(decimals)).toString(16);
}

function transferData(to: string, amount: number) {
  const address = to.replace(/^0x/, "").padStart(64, "0");
  const value = unit(amount).replace(/^0x/, "").padStart(64, "0");
  return `0xa9059cbb${address}${value}`;
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
    if (!res.ok) throw Error(body?.detail?.message ?? body?.detail?.[0]?.msg ?? `HTTP ${res.status}`);
    return body;
  }

  function showToast(next: Toast) {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(undefined), 5000);
  }

  async function pollUntilDone(id: number) {
    while (!cancelled.current) {
      const { data } = await json<{ data: { status: VerifyStatus } }>(`/payment/request/${id}/verify`, { method: "POST" });
      if (done.has(data.status)) return data.status;
      await sleep(3000);
    }
    throw Error("cancelled");
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProcessing(true);
    setToast(undefined);

    try {
      if (!window.ethereum) throw Error("wallet_missing");
      if (!token) throw Error("token_missing");

      const f = new FormData(e.currentTarget);
      const body = Object.fromEntries(["store_id", "user_id", "amount"].map((k) => [k, Number(f.get(k))]));
      const { data: pay } = await json<{ data: Pay }>("/payment/request", { method: "POST", body: JSON.stringify(body) });

      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${pay.chain_id.toString(16)}` }] });
      const [from] = await window.ethereum.request<string[]>({ method: "eth_requestAccounts" });
      if (from.toLowerCase() !== pay.from_wallet_address.toLowerCase()) throw Error("wallet_mismatch");

      const transaction_hash = await window.ethereum.request<string>({
        method: "eth_sendTransaction",
        params: [{ from, to: token, data: transferData(pay.to_wallet_address, pay.amount) }],
      });
      await json(`/payment/request/${pay.payment_request_id}/tx`, { method: "POST", body: JSON.stringify({ transaction_hash }) });

      const status = await pollUntilDone(pay.payment_request_id);
      showToast(
        status === "paid"
          ? { kind: "success", title: "決済完了", text: "決済が完了しました" }
          : { kind: "error", title: "決済失敗", text: "決済に失敗しました" },
      );
    } catch {
      if (!cancelled.current) showToast({ kind: "error", title: "決済失敗", text: "決済に失敗しました" });
    } finally {
      if (!cancelled.current) setProcessing(false);
    }
  }

  return (
    <main className="min-h-dvh bg-zinc-950 px-4 py-10 text-zinc-100">
      {toast && (
        <div
          role="status"
          className="fixed inset-0 z-10 grid place-items-center bg-black/45 px-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white px-6 py-7 text-center text-zinc-950 shadow-2xl">
            <div
              className={`mx-auto mb-4 grid size-16 place-items-center rounded-full ${
                toast.kind === "success" ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
              }`}
              aria-hidden="true"
            >
              {toast.kind === "success" ? (
                <svg className="size-9" viewBox="0 0 24 24" fill="none">
                  <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg className="size-9" viewBox="0 0 24 24" fill="none">
                  <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <p className="text-2xl font-bold">{toast.title}</p>
            <p className="mt-2 text-sm text-zinc-600">{toast.text}</p>
          </div>
        </div>
      )}

      <section className="mx-auto grid max-w-3xl gap-5">
        <h1 className="text-2xl font-semibold">Teraid Pay</h1>
        <form onSubmit={submit} className="grid gap-3 rounded-lg bg-white p-5 text-zinc-950 shadow-xl">
          {["store_id", "user_id", "amount"].map((name) => (
            <label key={name} className="grid gap-1 text-sm font-medium">
              {name === "amount" ? "送金額" : name}
              <input name={name} type="number" min="1" required className="rounded-md border px-3 py-2" />
            </label>
          ))}
          <button disabled={processing} className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {processing ? "決済中..." : "決済"}
          </button>
        </form>
      </section>
    </main>
  );
}
