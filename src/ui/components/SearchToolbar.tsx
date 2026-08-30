import type { ReactNode } from "react";
import { MAX_QUERY_LENGTH } from "../../core/contracts.js";
import { useMessages } from "../messages.js";

type Props = {
  query: string;
  total: number;
  loading: boolean;
  onChange: (query: string) => void;
  actions?: ReactNode;
};

export function SearchToolbar({ query, total, loading, onChange, actions }: Props) {
  const { t, locale } = useMessages();
  return (
    <div className="search-toolbar">
      <div className="search-row">
        <label>
          <span className="visually-hidden">{t("searchIcons")}</span>
          <span className="search-symbol" aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t("searchIcons")}
            maxLength={MAX_QUERY_LENGTH}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        {actions !== undefined && actions !== null && <div className="search-actions">{actions}</div>}
      </div>
      <div className="result-summary" aria-live="polite">
        <span>{t("iconsCount", { count: total.toLocaleString(locale) })}</span>
        {loading && <span>{t("loading")}</span>}
      </div>
    </div>
  );
}
