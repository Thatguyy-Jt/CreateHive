// Placeholder while a section's server data loads: muted blocks, no text.
export function SectionSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="stack-sm" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={`h-5 rounded-sm bg-surface-muted ${index === 0 ? "w-3/4" : "w-1/2"}`}
        />
      ))}
    </div>
  );
}
