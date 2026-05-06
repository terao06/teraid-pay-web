export function ProcessingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-20 grid place-items-center bg-zinc-950/70 px-4 backdrop-blur-sm"
    >
      <div className="grid w-full max-w-xs place-items-center gap-4 rounded-lg border border-white/10 bg-zinc-900 px-7 py-8 text-center shadow-2xl">
        <div className="grid size-16 place-items-center rounded-full bg-emerald-500/10">
          <div className="size-10 animate-spin rounded-full border-4 border-emerald-200/30 border-t-emerald-400" />
        </div>
        <div className="grid gap-1">
          <p className="text-lg font-semibold text-white">決済処理中</p>
          <p className="text-sm leading-6 text-zinc-300">完了までこのままお待ちください。</p>
        </div>
      </div>
    </div>
  );
}
