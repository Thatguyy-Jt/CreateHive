/** A labelled headline number. Proportional figures: tile values stand alone, they don't align in columns. */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">{value}</p>
      {note ? <p className="stat-tile-note">{note}</p> : null}
    </div>
  );
}
