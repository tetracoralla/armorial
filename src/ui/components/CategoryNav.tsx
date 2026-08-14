import type { CatalogData } from "../runtime.js";

type Props = {
  categories: CatalogData["categories"];
  total: number;
  selected: string | null;
  onSelect: (category: string | null) => void;
};

export function CategoryNav({ categories, total, selected, onSelect }: Props) {
  return (
    <nav className="category-nav" aria-label="Icon categories">
      <button className={selected === null ? "is-selected" : ""} type="button" onClick={() => onSelect(null)}>
        <span>All</span><span>{total}</span>
      </button>
      {categories.map((category) => (
        <button
          className={selected === category.id ? "is-selected" : ""}
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id)}
        >
          <span>{category.label}</span><span>{category.count}</span>
        </button>
      ))}
    </nav>
  );
}
