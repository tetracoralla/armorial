import type { CatalogData } from "../runtime-shared.js";
import { useMessages } from "../messages.js";

type Props = {
  categories: CatalogData["categories"];
  total: number;
  selected: string | null;
  onSelect: (category: string | null) => void;
};

export function CategoryNav({ categories, total, selected, onSelect }: Props) {
  const { t, locale } = useMessages();
  return (
    <nav className="category-nav" aria-label={t("iconCategories")}>
      <button className={selected === null ? "is-selected" : ""} type="button" onClick={() => onSelect(null)}>
        <span>{t("all")}</span><span>{total}</span>
      </button>
      {categories.map((category) => (
        <button
          className={selected === category.id ? "is-selected" : ""}
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id)}
        >
          <span>{locale === "zh-CN" ? category.labelCN : category.label}</span><span>{category.count}</span>
        </button>
      ))}
    </nav>
  );
}
