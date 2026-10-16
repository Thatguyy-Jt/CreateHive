/** A labelled headline number. Proportional figures: tile values stand alone, they don't align in columns. */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="grid content-start gap-1 rounded-md border border-border p-4">
      <p className="field-help">{label}</p>
      <p className="text-3xl font-semibold leading-tight">{value}</p>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </div>
  );
}
