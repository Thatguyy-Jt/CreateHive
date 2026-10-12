export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-lg font-extrabold tracking-tight ${className}`}>
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M16 2 28 9v14l-12 7-12-7V9z" fill="var(--primary)" />
        <path d="M13 11.5 21.5 16 13 20.5z" fill="var(--primary-foreground)" />
      </svg>
      CreateHive
    </span>
  );
}
