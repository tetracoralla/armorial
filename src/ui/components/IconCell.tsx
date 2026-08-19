import { memo, type KeyboardEvent } from "react";
import type { CatalogItem } from "../../core/contracts.js";
import { setSvgDragData } from "../runtime.js";
import { svgDataUri } from "../svg-data-uri.js";

type Props = {
  item: CatalogItem;
  selected: boolean;
  tabIndex: number;
  onSelect: (item: CatalogItem) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragEnd?: ((event: DragEvent, item: CatalogItem) => void) | undefined;
  dragDisabled?: boolean;
};

// Memoized so selection, loading, and notice changes reconcile only the cells
// whose own props changed instead of re-encoding every data URI.
export const IconCell = memo(function IconCell({ item, selected, tabIndex, onSelect, onKeyDown, onDragEnd, dragDisabled = false }: Props) {
  return (
    <button
      className={`icon-cell ${selected ? "is-selected" : ""}`}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      draggable={!dragDisabled}
      title={`${item.name} · ${item.title}`}
      onClick={() => onSelect(item)}
      onKeyDown={onKeyDown}
      onDragStart={dragDisabled ? undefined : (event) => setSvgDragData(event.nativeEvent, item.name, item.asset.svg)}
      onDragEnd={dragDisabled ? undefined : (event) => onDragEnd?.(event.nativeEvent, item)}
    >
      <img src={svgDataUri(item.asset.svg)} alt="" draggable={false} />
      <span>{item.name}</span>
    </button>
  );
});
