type PaymentFormProps = {
  processing: boolean;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
};

const fields = ["store_id", "user_id", "amount"] as const;

export function PaymentForm({ processing, onSubmit }: PaymentFormProps) {
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-lg bg-white p-5 text-zinc-950 shadow-xl">
      {fields.map((name) => (
        <label key={name} className="grid gap-1 text-sm font-medium">
          {name === "amount" ? "金額" : name}
          <input name={name} type="number" min="1" required disabled={processing} className="rounded-md border px-3 py-2 disabled:bg-zinc-100" />
        </label>
      ))}
      <button disabled={processing} className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
        {processing ? "決済中..." : "決済"}
      </button>
    </form>
  );
}
