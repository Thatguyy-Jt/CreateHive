/** An analytics page's server read failed. */
export function LoadError() {
  return (
    <div role="alert" className="card max-w-3xl stack-sm">
      <h2 className="text-heading">Something went wrong</h2>
      <p className="text-muted-foreground">We couldn&apos;t load your results right now. Refresh the page to try again.</p>
    </div>
  );
}
