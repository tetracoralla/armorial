import { memo, useMemo, type CSSProperties, type KeyboardEvent } from "react";
import type { CatalogItem } from "../../core/contracts.js";
import { setSvgDragData } from "../runtime-shared.js";
import { svgDataUri } from "../svg-data-uri.js";

type Props = {
  item: CatalogItem;
  index: number;
  setSize: number;
  selected: boolean;
  tabIndex: number;
  style?: CSSProperties | undefined;
  onSelect: (item: CatalogItem) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragEnd?: ((event: DragEvent, item: CatalogItem) => void) | undefined;
  dragDisabled?: boolean;
};

// Memoized so selection, loading, and notice changes reconcile only the cells
// whose own props changed instead of re-encoding every data URI.
export const IconCell = memo(function IconCell({ item, index, setSize, selected, tabIndex, style, onSelect, onKeyDown, onDragEnd, dragDisabled = false }: Props) {
  const imageSource = useMemo(() => svgDataUri(item.asset.svg), [item.asset.svg]);
  return (
    <button
      className={`icon-cell ${selected ? "is-selected" : ""}`}
      type="button"
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      data-index={index}
      tabIndex={tabIndex}
      style={style}
      draggable={!dragDisabled}
      title={`${item.name} · ${item.title}`}
      onClick={() => onSelect(item)}
      onKeyDown={onKeyDown}
      onDragStart={dragDisabled ? undefined : (event) => setSvgDragData(event.nativeEvent, item.name, item.asset.svg)}
      onDragEnd={dragDisabled ? undefined : (event) => onDragEnd?.(event.nativeEvent, item)}
    >
      <img src={imageSource} alt="" draggable={false} />
      <span>{item.name}</span>
    </button>
  );
});
