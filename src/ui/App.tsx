import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_UI_CATALOG_ITEMS,
  type BrowseIconsInput,
  type CatalogItem,
  type ChooseIconInput,
  type RenderStyle,
  type RenderStyleOverride,
} from "../core/contracts.js";
import { createIconSelectionDecision, formatIconSelectionMessage } from "../core/selection.js";
import { AppHeader } from "./components/AppHeader.js";
import { CategoryNav } from "./components/CategoryNav.js";
import { IconGrid } from "./components/IconGrid.js";
import { FigmaInspector } from "./components/FigmaInspector.js";
import { Inspector, type ActionState } from "./components/Inspector.js";
import { SearchToolbar } from "./components/SearchToolbar.js";
import { copyText, isFigmaPickerRuntime, type CatalogData, type PickerRuntime } from "./runtime.js";

const PAGE_SIZE = MAX_UI_CATALOG_ITEMS;

type LoadBasis = {
  query: string;
  category: string | null;
};

function renderOverrideKey(value: RenderStyleOverride | null): string {
  return JSON.stringify(value);
}

export function App({ runtime }: { runtime: PickerRuntime }) {
  const initial = runtime.initialCatalog;
  const [catalog, setCatalog] = useState<CatalogData | null>(initial);
  const [items, setItems] = useState<CatalogItem[]>(initial?.items ?? []);
  const [query, setQuery] = useState(runtime.session?.intent ?? initial?.query ?? "");
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  const [selected, setSelected] = useState<CatalogItem | null>(initial?.items[0] ?? null);
  const [styleOverride, setStyleOverride] = useState<RenderStyleOverride | null>(
    runtime.session?.render ?? null,
  );
  const [appliedStyleOverride, setAppliedStyleOverride] = useState<RenderStyleOverride | null>(
    initial === null ? null : runtime.session?.render ?? null,
  );
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [figmaCompact, setFigmaCompact] = useState(false);
  const [hostSession, setHostSession] = useState<ChooseIconInput | null>(runtime.session);
  const requestSequence = useRef(0);
  const hasInitialCatalog = useRef(initial !== null);
  const appliedHostInitialState = useRef(initial !== null);
  const appliedSession = useRef<ChooseIconInput | null>(runtime.session);
  const appliedFigmaInitialState = useRef(false);
  const lastFigmaReceiptId = useRef<string | null>(null);
  const lastFigmaError = useRef<string | null>(null);
  const [figmaHydrated, setFigmaHydrated] = useState(!isFigmaPickerRuntime(runtime));
  const lastLoadBasis = useRef<LoadBasis | null>(null);

  // Optimistic display style: the loaded catalog reports the context-resolved
  // policy with the previous override applied; the pending override leads so
  // controls track the hand while the debounced reload lands.
  const displayStyle = useMemo<RenderStyle | null>(() => {
    if (catalog === null) return null;
    const policy = catalog.policy;
    const colors = styleOverride?.colors;
    return {
      theme: styleOverride?.theme ?? policy.theme,
      size: styleOverride?.size ?? policy.size,
      strokeWidth: styleOverride?.strokeWidth ?? policy.strokeWidth,
      strokeLinecap: styleOverride?.strokeLinecap ?? policy.strokeLinecap,
      strokeLinejoin: styleOverride?.strokeLinejoin ?? policy.strokeLinejoin,
      colors: {
        primary: colors?.primary ?? policy.colors.primary,
        secondary: colors?.secondary ?? policy.colors.secondary,
        innerStroke: colors?.innerStroke ?? policy.colors.innerStroke,
        innerFill: colors?.innerFill ?? policy.colors.innerFill,
      },
    };
  }, [catalog?.policy, styleOverride]);

  const sessionIntent = useMemo(
    () => hostSession?.intent ?? (query.trim() || selected?.name || "selected icon"),
    [query, hostSession?.intent, selected?.name],
  );
  const allIconCount = useMemo(
    () => catalog?.categories.reduce((sum, item) => sum + item.count, 0) ?? 0,
    [catalog?.categories],
  );
  const renderPending = renderOverrideKey(styleOverride) !== renderOverrideKey(appliedStyleOverride);

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
      setAppliedStyleOverride(input.render ?? null);
      setItems((current) => append ? [...current, ...output.items] : output.items);
      if (!append) {
        setSelected((current) => output.items.find((item) => item.id === current?.id) ?? output.items[0] ?? null);
      }
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load icons.");
      if (
        !append
        && renderOverrideKey(input.render ?? null) !== renderOverrideKey(appliedStyleOverride)
      ) {
        // The selected SVGs still carry the last successful render. Return the
        // controls to that usable state so a failed redraw cannot strand every
        // export action behind a permanently pending optimistic override.
        setStyleOverride(appliedStyleOverride);
      }
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
        setStyleOverride(nextSession.render ?? null);
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
    if (!isFigmaPickerRuntime(runtime)) return;
    return runtime.onFigmaState((state) => {
      if (!state.hydrated) return;
      if (!appliedFigmaInitialState.current) {
        appliedFigmaInitialState.current = true;
        setStyleOverride(state.render);
        setFigmaHydrated(true);
      }
      if (state.lastReceipt !== null && state.lastReceipt.requestId !== lastFigmaReceiptId.current) {
        lastFigmaReceiptId.current = state.lastReceipt.requestId;
        lastFigmaError.current = null;
        setError(null);
        setNotice(`Placed ${state.lastReceipt.nodeName} in ${state.lastReceipt.parentName}`);
      }
      if (state.error !== null && state.error !== lastFigmaError.current) {
        lastFigmaError.current = state.error;
        setError(state.error);
      } else if (state.error === null) {
        lastFigmaError.current = null;
      }
    });
  }, [runtime]);

  useEffect(() => {
    if (!figmaHydrated || !isFigmaPickerRuntime(runtime)) return;
    runtime.saveFigmaRender(styleOverride);
  }, [figmaHydrated, runtime, styleOverride]);

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
        ...(styleOverride === null ? {} : { render: styleOverride }),
      };
      void loadCatalog(input);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [category, query, hostSession, styleOverride, runtime]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(
      () => setNotice(null),
      isFigmaPickerRuntime(runtime) ? 4_000 : 2_400,
    );
    return () => window.clearTimeout(timer);
  }, [notice, runtime]);

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

  const applyOverride = (patch: RenderStyleOverride) => {
    setStyleOverride((current) => {
      const base = current ?? {};
      return {
        ...base,
        ...patch,
        ...(patch.colors === undefined ? {} : { colors: { ...base.colors, ...patch.colors } }),
      };
    });
  };

  const resetOverride = () => setStyleOverride(null);

  async function selectionMessage() {
    if (selected === null || catalog === null) throw new Error("Select an icon first.");
    const render: RenderStyle = {
      theme: catalog.policy.theme,
      size: catalog.policy.size,
      strokeWidth: catalog.policy.strokeWidth,
      strokeLinecap: catalog.policy.strokeLinecap,
      strokeLinejoin: catalog.policy.strokeLinejoin,
      colors: catalog.policy.colors,
    };
    const decision = await createIconSelectionDecision({
      ...(hostSession?.requestId === undefined ? {} : { requestId: hostSession.requestId }),
      iconId: selected.id,
      intent: sessionIntent,
      context: catalog.context,
      render,
      assetSha256: selected.asset.sha256,
    });
    return { decision, message: formatIconSelectionMessage(decision) };
  }

  const selectCategory = (nextCategory: string | null) => {
    setCategory(nextCategory);
    setItems([]);
  };

  const toggleFigmaCompact = () => {
    if (!isFigmaPickerRuntime(runtime)) return;
    const next = !figmaCompact;
    setFigmaCompact(next);
    runtime.resizeFigmaUi(next);
  };

  // Stable identity keeps the memoized icon cells from re-encoding their SVG
  // data URIs on every state change in the Figma build.
  const handleFigmaDragEnd = useCallback((event: DragEvent, item: CatalogItem) => {
    if (isFigmaPickerRuntime(runtime)) runtime.dragIcon(event, item);
  }, [runtime]);

  const loadMore = async () => {
    const basis = lastLoadBasis.current ?? { query: query.trim(), category };
    await loadCatalog({
      query: basis.query,
      ...(basis.category === null ? {} : { category: basis.category }),
      ...(hostSession?.context === undefined ? {} : { context: hostSession.context }),
      offset: items.length,
      limit: PAGE_SIZE,
      // Appended pages must match the pages they extend: the applied override,
      // not one still waiting for its debounced reload.
      ...(appliedStyleOverride === null ? {} : { render: appliedStyleOverride }),
    }, true);
  };

  return (
    <div className={`app-shell${figmaCompact ? " is-figma-compact" : ""}`}>
      <AppHeader
        runtime={runtime}
        {...(isFigmaPickerRuntime(runtime)
          ? { figmaCompact, onFigmaCompactToggle: toggleFigmaCompact }
          : {})}
      />
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
            onDragEnd={isFigmaPickerRuntime(runtime) ? handleFigmaDragEnd : undefined}
            dragDisabled={isFigmaPickerRuntime(runtime) && renderPending}
          />
        </main>
        {isFigmaPickerRuntime(runtime) ? (
          <FigmaInspector
            selected={selected}
            style={displayStyle}
            hasOverride={styleOverride !== null}
            renderPending={renderPending}
            runtime={runtime}
            actionState={actionState}
            onAppearanceChange={applyOverride}
            onAppearanceReset={resetOverride}
            onInsert={() => withAction("inserting", async () => {
              if (selected === null) throw new Error("Select an icon first.");
              await runtime.insertIcon(selected);
            }, runtime.figmaState.settings.createComponent ? "Component inserted" : "Icon inserted")}
          />
        ) : (
        <Inspector
          selected={selected}
          style={displayStyle}
          context={catalog?.context ?? null}
          hasOverride={styleOverride !== null}
          renderPending={renderPending}
          runtime={runtime}
          actionState={actionState}
          onAppearanceChange={applyOverride}
          onAppearanceReset={resetOverride}
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
        )}
      </div>
      <div className="toast" aria-live="polite">{notice}</div>
    </div>
  );
}
