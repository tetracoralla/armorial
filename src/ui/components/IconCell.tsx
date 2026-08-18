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
};

// Memoized so selection, loading, and notice changes reconcile only the cells
// whose own props changed instead of re-encoding every data URI.
export const IconCell = memo(function IconCell({ item, selected, tabIndex, onSelect, onKeyDown }: Props) {
  return (
    <button
      className={`icon-cell ${selected ? "is-selected" : ""}`}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      draggable
      title={`${item.name} · ${item.title}`}
      onClick={() => onSelect(item)}
      onKeyDown={onKeyDown}
      onDragStart={(event) => setSvgDragData(event.nativeEvent, item.name, item.asset.svg)}
    >
      <img src={svgDataUri(item.asset.svg)} alt="" draggable={false} />
      <span>{item.name}</span>
    </button>
  );
});
