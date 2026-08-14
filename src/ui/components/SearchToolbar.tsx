type Props = {
  query: string;
  total: number;
  loading: boolean;
  onChange: (query: string) => void;
};

export function SearchToolbar({ query, total, loading, onChange }: Props) {
  return (
    <div className="search-toolbar">
      <label>
        <span className="visually-hidden">Search icons</span>
        <span className="search-symbol" aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search icons"
          maxLength={120}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="result-summary" aria-live="polite">
        <span>{total.toLocaleString()} icons</span>
        {loading && <span>Loading…</span>}
      </div>
    </div>
  );
}
