import type { Toast } from "@/app/types/payment";

type PaymentResultDialogProps = {
  toast: Toast;
  durationMs: number;
};

export function PaymentResultDialog({ toast, durationMs }: PaymentResultDialogProps) {
  const isSuccess = toast.kind === "success";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-30 grid place-items-center bg-zinc-950/70 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-zinc-200 bg-white text-center text-zinc-950 shadow-2xl shadow-black/30">
        <div className="h-2 bg-zinc-100">
          <div
            className={`h-full origin-right animate-result-timer ${isSuccess ? "bg-emerald-500" : "bg-red-500"}`}
            style={{ animationDuration: `${durationMs}ms` }}
          />
        </div>
        <div className="grid place-items-center px-6 py-8">
          <div
            className={`grid size-24 place-items-center rounded-full border-8 ${
              isSuccess ? "border-emerald-100 bg-emerald-500 text-white" : "border-red-100 bg-red-500 text-white"
            }`}
            aria-hidden="true"
          >
            {isSuccess ? (
              <svg className="size-14" viewBox="0 0 24 24" fill="none">
                <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg className="size-14" viewBox="0 0 24 24" fill="none">
                <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <p className="mt-6 text-3xl font-bold tracking-normal">{toast.title}</p>
          {toast.amount !== undefined && (
            <p className="mt-4 rounded-md bg-zinc-100 px-6 py-3 text-4xl font-bold tabular-nums">
              {toast.amount.toLocaleString()}
              <span className="ml-1 text-lg font-semibold text-zinc-600">円</span>
            </p>
          )}
          <p className="mt-4 text-base font-medium text-zinc-600">{toast.text}</p>
        </div>
      </div>
    </div>
  );
}
