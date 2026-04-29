export function Progress({ value }: { value: number }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full bg-sky-400" style={{ width: `${bounded}%` }} />
    </div>
  );
}
