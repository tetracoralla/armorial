import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CatalogItem } from "../../core/contracts.js";
import type { KeyboardEvent } from "react";
import { IconCell } from "./IconCell.js";
import { useMessages } from "../messages.js";

type Props = {
  items: CatalogItem[];
  total: number;
  selectedId: string | null;
  hasMore: boolean;
  loading: boolean;
  onSelect: (item: CatalogItem) => void;
  onLoadMore: () => void;
  onDragEnd?: ((event: DragEvent, item: CatalogItem) => void) | undefined;
  dragDisabled?: boolean;
};

const CELL_HEIGHT = 92;
const GRID_GAP = 8;
const ROW_STRIDE = CELL_HEIGHT + GRID_GAP;
const VIRTUALIZE_AFTER_ITEMS = 180;
const OVERSCAN_ROWS = 4;

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

export function IconGrid({ items, total, selectedId, hasMore, loading, onSelect, onLoadMore, onDragEnd, dragDisabled = false }: Props) {
  const { t } = useMessages();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0, columns: 1 });
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const virtualized = items.length > VIRTUALIZE_AFTER_ITEMS;

  const measureViewport = useCallback(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (scroller === null || grid === null) return;
    const compact = grid.closest(".app-shell")?.classList.contains("is-figma-compact") ?? false;
    const minimumCellWidth = compact ? 74 : 82;
    const columns = Math.max(1, Math.floor((grid.clientWidth + GRID_GAP) / (minimumCellWidth + GRID_GAP)));
    setViewport((current) => {
      const next = { scrollTop: scroller.scrollTop, height: scroller.clientHeight, columns };
      return current.scrollTop === next.scrollTop
        && current.height === next.height
        && current.columns === next.columns
        ? current
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (scroller === null || grid === null) return;
    let frame = 0;
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measureViewport);
    };
    const observer = new ResizeObserver(measureViewport);
    observer.observe(scroller);
    observer.observe(grid);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    measureViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [measureViewport]);

  const visibleRange = useMemo(() => {
    if (!virtualized) return { start: 0, end: items.length };
    const rows = Math.ceil(items.length / viewport.columns);
    const startRow = Math.max(0, Math.floor(viewport.scrollTop / ROW_STRIDE) - OVERSCAN_ROWS);
    const endRow = Math.min(
      rows,
      Math.ceil((viewport.scrollTop + viewport.height) / ROW_STRIDE) + OVERSCAN_ROWS,
    );
    return {
      start: startRow * viewport.columns,
      end: Math.min(items.length, endRow * viewport.columns),
    };
  }, [items.length, viewport, virtualized]);

  const visibleItems = useMemo(
    () => items.slice(visibleRange.start, visibleRange.end).map((item, offset) => ({
      item,
      index: visibleRange.start + offset,
    })),
    [items, visibleRange],
  );
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const tabStopIndex = selectedIndex >= visibleRange.start && selectedIndex < visibleRange.end
    ? selectedIndex
    : visibleRange.start;

  useLayoutEffect(() => {
    if (pendingFocusIndex === null) return;
    const target = gridRef.current?.querySelector<HTMLButtonElement>(`[data-index="${pendingFocusIndex}"]`);
    if (target === null || target === undefined) return;
    target.focus();
    setPendingFocusIndex(null);
  }, [pendingFocusIndex, visibleRange]);

  function virtualCellStyle(index: number): CSSProperties | undefined {
    if (!virtualized) return undefined;
    const row = Math.floor(index / viewport.columns);
    const column = index % viewport.columns;
    const columnPercent = 100 / viewport.columns;
    const gapShare = GRID_GAP / viewport.columns;
    return {
      top: row * ROW_STRIDE,
      left: `calc(${column * columnPercent}% + ${column * gapShare}px)`,
      width: `calc(${columnPercent}% - ${(viewport.columns - 1) * gapShare}px)`,
      height: CELL_HEIGHT,
    };
  }

  const handleCellKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const listbox = event.currentTarget.closest<HTMLElement>('[role="listbox"]');
    if (listbox === null) return;
    const current = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(current) || current < 0) return;
    const columns = virtualized
      ? viewport.columns
      : visualColumnCount(optionButtons(listbox));
    const target = keyboardTargetIndex(event.key, current, items.length, columns);
    if (target === null) return;
    event.preventDefault();
    if (target === current) return;
    const targetItem = items[target];
    if (targetItem === undefined) return;
    onSelect(targetItem);
    const targetOption = gridRef.current?.querySelector<HTMLButtonElement>(`[data-index="${target}"]`);
    if (targetOption !== null && targetOption !== undefined) {
      targetOption.focus();
      return;
    }
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const targetTop = Math.floor(target / columns) * ROW_STRIDE;
    const targetBottom = targetTop + CELL_HEIGHT;
    const nextScrollTop = targetTop < scroller.scrollTop
      ? targetTop
      : Math.max(0, targetBottom - scroller.clientHeight);
    scroller.scrollTop = nextScrollTop;
    setViewport((currentViewport) => ({ ...currentViewport, scrollTop: nextScrollTop }));
    setPendingFocusIndex(target);
  }, [items, onSelect, viewport.columns, virtualized]);

  if (items.length === 0 && !loading) {
    return <div className="empty-state">{t("noMatchingIcons")}</div>;
  }

  return (
    <div className="catalog-scroll" ref={scrollRef}>
      <div
        className={`icon-grid${virtualized ? " is-virtualized" : ""}`}
        role="listbox"
        aria-label={t("iconResults")}
        aria-busy={loading}
        data-loaded-count={items.length}
        ref={gridRef}
        style={virtualized
          ? { height: Math.max(0, Math.ceil(items.length / viewport.columns) * ROW_STRIDE - GRID_GAP) }
          : undefined}
      >
        {visibleItems.map(({ item, index }) => (
          <IconCell
            key={item.id}
            item={item}
            index={index}
            setSize={total}
            selected={selectedId === item.id}
            tabIndex={index === tabStopIndex ? 0 : -1}
            style={virtualCellStyle(index)}
            onSelect={onSelect}
            onKeyDown={handleCellKeyDown}
            onDragEnd={onDragEnd}
            dragDisabled={dragDisabled}
          />
        ))}
      </div>
      {hasMore && (
        <button className="load-more" type="button" disabled={loading} onClick={onLoadMore}>
          {loading ? t("loading") : t("loadMore")}
        </button>
      )}
    </div>
  );
}
