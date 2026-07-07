export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      {label}
      <input min={0} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}
