import type { CatalogItem, RenderStyle, RenderStyleOverride } from "../../core/contracts.js";
import type { PickerRuntime } from "../runtime.js";
import { svgDataUri } from "../svg-data-uri.js";
import { AppearancePanel } from "./AppearancePanel.js";

type ActionState = "idle" | "copying-svg" | "copying-agent" | "downloading" | "attaching" | "continuing" | "inserting";

type Props = {
  selected: CatalogItem | null;
  style: RenderStyle | null;
  context: string | null;
  hasOverride: boolean;
  renderPending: boolean;
  runtime: PickerRuntime;
  actionState: ActionState;
  onAppearanceChange: (patch: RenderStyleOverride) => void;
  onAppearanceReset: () => void;
  onCopySvg: () => Promise<void>;
  onDownload: () => Promise<void>;
  onCopyForAgent: () => Promise<void>;
  onAttach: () => Promise<void>;
  onContinue: () => Promise<void>;
};

export function Inspector(props: Props) {
  const { selected, style, context, hasOverride, renderPending, runtime, actionState } = props;
  if (selected === null || style === null) {
    return <aside className="inspector inspector-empty">Select an icon to preview it</aside>;
  }

  return (
    <aside className={`inspector${renderPending ? " is-rendering" : ""}`}>
      <div className="preview-panel">
        <img src={svgDataUri(selected.asset.svg)} alt={`${selected.name} preview`} />
        <div>
          <h2>{selected.name}</h2>
          <p>{selected.title}</p>
          <code>{selected.id}</code>
        </div>
      </div>
      <div className="action-stack" aria-label="Human export actions">
        <button className="primary-action" type="button" disabled={renderPending || actionState !== "idle"} onClick={() => void props.onCopySvg()}>
          {actionState === "copying-svg" ? "Copying…" : "Copy SVG"}
        </button>
        <button type="button" disabled={renderPending || actionState !== "idle"} onClick={() => void props.onDownload()}>
          {actionState === "downloading" ? "Downloading…" : "Download"}
        </button>
        <button type="button" disabled={renderPending || actionState !== "idle"} onClick={() => void props.onCopyForAgent()}>
          {actionState === "copying-agent" ? "Copying…" : "Copy for Agent"}
        </button>
      </div>
      {runtime.mode === "embedded" && (runtime.canAttach || runtime.canContinue) && (
        <section className="agent-actions" aria-label="Agent actions">
          <h3>Agent</h3>
          {runtime.canAttach && (
            <button type="button" disabled={renderPending || actionState !== "idle"} onClick={() => void props.onAttach()}>
              {actionState === "attaching" ? "Attaching…" : "Attach to conversation"}
            </button>
          )}
          {runtime.canContinue && (
            <button className="continue-action" type="button" disabled={renderPending || actionState !== "idle"} onClick={() => void props.onContinue()}>
              {actionState === "continuing" ? "Sending…" : "Select & continue"}
            </button>
          )}
        </section>
      )}
      <AppearancePanel
        style={style}
        context={context}
        hasOverride={hasOverride}
        isRendering={renderPending}
        onChange={props.onAppearanceChange}
        onReset={props.onAppearanceReset}
      />
    </aside>
  );
}

export type { ActionState };
