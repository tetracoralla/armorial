import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_UI_CATALOG_ITEMS,
  type BrowseIconsInput,
  type CatalogItem,
  type ChooseIconInput,
} from "../core/contracts.js";
import { createIconSelectionDecision, formatIconSelectionMessage } from "../core/selection.js";
import { AppHeader } from "./components/AppHeader.js";
import { CategoryNav } from "./components/CategoryNav.js";
import { IconGrid } from "./components/IconGrid.js";
import { Inspector, type ActionState } from "./components/Inspector.js";
import { SearchToolbar } from "./components/SearchToolbar.js";
import { copyText, type CatalogData, type PickerRuntime } from "./runtime.js";

const PAGE_SIZE = MAX_UI_CATALOG_ITEMS;

type LoadBasis = {
  query: string;
  category: string | null;
};

export function App({ runtime }: { runtime: PickerRuntime }) {
  const initial = runtime.initialCatalog;
  const [catalog, setCatalog] = useState<CatalogData | null>(initial);
  const [items, setItems] = useState<CatalogItem[]>(initial?.items ?? []);
  const [query, setQuery] = useState(runtime.session?.intent ?? initial?.query ?? "");
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  const [selected, setSelected] = useState<CatalogItem | null>(initial?.items[0] ?? null);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [hostSession, setHostSession] = useState<ChooseIconInput | null>(runtime.session);
  const requestSequence = useRef(0);
  const hasInitialCatalog = useRef(initial !== null);
  const appliedHostInitialState = useRef(initial !== null);
  const appliedSession = useRef<ChooseIconInput | null>(runtime.session);
  const lastLoadBasis = useRef<LoadBasis | null>(null);

  const sessionIntent = useMemo(
    () => hostSession?.intent ?? (query.trim() || selected?.name || "selected icon"),
    [query, hostSession?.intent, selected?.name],
  );
  const allIconCount = useMemo(
    () => catalog?.categories.reduce((sum, item) => sum + item.count, 0) ?? 0,
    [catalog?.categories],
  );

  async function loadCatalog(input: BrowseIconsInput, append = false): Promise<void> {
    const sequence = ++requestSequence.current;
    lastLoadBasis.current = { query: input.query ?? "", category: input.category ?? null };
    setLoading(true);
    setError(null);
    try {
      const output = await runtime.browse(input);
      if (sequence !== requestSequence.current) return;
      if (output.status !== "ok") throw new Error(output.error.message);
      setCatalog(output);
      setItems((current) => append ? [...current, ...output.items] : output.items);
      if (!append) {
        setSelected((current) => output.items.find((item) => item.id === current?.id) ?? output.items[0] ?? null);
      }
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load icons.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    return runtime.onInitialState((nextCatalog, nextSession) => {
      if (nextSession !== null && nextSession !== appliedSession.current) {
        appliedSession.current = nextSession;
        setHostSession(nextSession);
        setQuery(nextSession.intent);
        setCategory(null);
      }
      if (nextCatalog !== null && !appliedHostInitialState.current) {
        appliedHostInitialState.current = true;
        hasInitialCatalog.current = true;
        setCatalog(nextCatalog);
        setItems(nextCatalog.items);
        setCategory(nextCatalog.category);
        setSelected(nextCatalog.items[0] ?? null);
        setLoading(false);
      }
    });
  }, [runtime]);

  useEffect(() => {
    if (hasInitialCatalog.current) {
      hasInitialCatalog.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const input: BrowseIconsInput = {
        query: query.trim(),
        ...(category === null ? {} : { category }),
        ...(hostSession?.context === undefined ? {} : { context: hostSession.context }),
        offset: 0,
        limit: PAGE_SIZE,
      };
      void loadCatalog(input);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [category, query, hostSession, runtime]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function withAction(state: ActionState, action: () => Promise<void>, success: string): Promise<void> {
    setActionState(state);
    setError(null);
    try {
      await action();
      setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The action did not complete.");
    } finally {
      setActionState("idle");
    }
  }

  async function selectionMessage() {
    if (selected === null) throw new Error("Select an icon first.");
    const decision = await createIconSelectionDecision({
      ...(hostSession?.requestId === undefined ? {} : { requestId: hostSession.requestId }),
      iconId: selected.id,
      intent: sessionIntent,
      context: catalog?.context ?? null,
      assetSha256: selected.asset.sha256,
    });
    return { decision, message: formatIconSelectionMessage(decision) };
  }

  const selectCategory = (nextCategory: string | null) => {
    setCategory(nextCategory);
    setItems([]);
  };

  const loadMore = async () => {
    const basis = lastLoadBasis.current ?? { query: query.trim(), category };
    await loadCatalog({
      query: basis.query,
      ...(basis.category === null ? {} : { category: basis.category }),
      ...(hostSession?.context === undefined ? {} : { context: hostSession.context }),
      offset: items.length,
      limit: PAGE_SIZE,
    }, true);
  };

  return (
    <div className="app-shell">
      <AppHeader runtime={runtime} />
      <div className="workspace">
        <CategoryNav
          categories={catalog?.categories ?? []}
          total={allIconCount}
          selected={category}
          onSelect={selectCategory}
        />
        <main className="catalog-pane">
          <SearchToolbar query={query} total={catalog?.total ?? 0} loading={loading} onChange={setQuery} />
          {error !== null && <div className="error-banner" role="alert">{error}</div>}
          <IconGrid
            items={items}
            selectedId={selected?.id ?? null}
            hasMore={catalog?.truncated ?? false}
            loading={loading}
            onSelect={setSelected}
            onLoadMore={() => void loadMore()}
          />
        </main>
        <Inspector
          selected={selected}
          catalog={catalog}
          runtime={runtime}
          actionState={actionState}
          onCopySvg={() => withAction("copying-svg", async () => {
            if (selected === null) throw new Error("Select an icon first.");
            await copyText(selected.asset.svg);
          }, "SVG copied")}
          onDownload={() => withAction("downloading", async () => {
            if (selected === null) throw new Error("Select an icon first.");
            await runtime.download(selected.name, selected.asset.svg);
          }, "Download started")}
          onCopyForAgent={() => withAction("copying-agent", async () => {
            const { message } = await selectionMessage();
            await copyText(message);
          }, "Agent selection copied")}
          onAttach={() => withAction("attaching", async () => {
            const { decision, message } = await selectionMessage();
            await runtime.attach(decision, message);
          }, "Selection attached")}
          onContinue={() => withAction("continuing", async () => {
            const { message } = await selectionMessage();
            await runtime.continueTask(message);
          }, "Selection sent")}
        />
      </div>
      <div className="toast" aria-live="polite">{notice}</div>
    </div>
  );
}
