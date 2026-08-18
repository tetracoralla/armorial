import { useCallback } from "react";
import type { CatalogItem } from "../../core/contracts.js";
import type { KeyboardEvent } from "react";
import { IconCell } from "./IconCell.js";

type Props = {
  items: CatalogItem[];
  selectedId: string | null;
  hasMore: boolean;
  loading: boolean;
  onSelect: (item: CatalogItem) => void;
  onLoadMore: () => void;
};

function optionButtons(listbox: HTMLElement): HTMLButtonElement[] {
  return Array.from(listbox.querySelectorAll<HTMLButtonElement>('[role="option"]'));
}

function visualColumnCount(options: readonly HTMLButtonElement[]): number {
  const firstTop = options[0]?.offsetTop;
  if (firstTop === undefined) return 1;
  const nextRowIndex = options.findIndex((option) => option.offsetTop !== firstTop);
  return nextRowIndex === -1 ? options.length : Math.max(1, nextRowIndex);
}

function keyboardTargetIndex(key: string, current: number, count: number, columns: number): number | null {
  const currentRow = Math.floor(current / columns);
  const lastRow = Math.floor((count - 1) / columns);
  switch (key) {
    case "ArrowLeft": return Math.max(0, current - 1);
    case "ArrowRight": return Math.min(count - 1, current + 1);
    case "ArrowUp": return currentRow === 0 ? current : current - columns;
    case "ArrowDown": return currentRow === lastRow ? current : Math.min(count - 1, current + columns);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

export function IconGrid({ items, selectedId, hasMore, loading, onSelect, onLoadMore }: Props) {
  const handleCellKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const listbox = event.currentTarget.parentElement;
    if (listbox === null) return;
    const options = optionButtons(listbox);
    const current = options.indexOf(event.currentTarget);
    if (current < 0) return;
    const target = keyboardTargetIndex(event.key, current, options.length, visualColumnCount(options));
    if (target === null) return;
    event.preventDefault();
    if (target === current) return;
    const targetOption = options[target];
    const targetItem = items[target];
    if (targetOption === undefined || targetItem === undefined) return;
    onSelect(targetItem);
    targetOption.focus();
  }, [items, onSelect]);

  if (items.length === 0 && !loading) {
    return <div className="empty-state">No matching icons</div>;
  }

  return (
    <div className="catalog-scroll">
      <div className="icon-grid" role="listbox" aria-label="Icon results">
        {items.map((item, index) => (
          <IconCell
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            tabIndex={selectedId === item.id || (selectedId === null && index === 0) ? 0 : -1}
            onSelect={onSelect}
            onKeyDown={handleCellKeyDown}
          />
        ))}
      </div>
      {hasMore && (
        <button className="load-more" type="button" disabled={loading} onClick={onLoadMore}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
