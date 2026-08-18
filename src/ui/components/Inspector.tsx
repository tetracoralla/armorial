import type { CatalogItem } from "../../core/contracts.js";
import type { CatalogData, PickerRuntime } from "../runtime.js";
import { svgDataUri } from "../svg-data-uri.js";

type ActionState = "idle" | "copying-svg" | "copying-agent" | "downloading" | "attaching" | "continuing";

type Props = {
  selected: CatalogItem | null;
  catalog: CatalogData | null;
  runtime: PickerRuntime;
  actionState: ActionState;
  onCopySvg: () => Promise<void>;
  onDownload: () => Promise<void>;
  onCopyForAgent: () => Promise<void>;
  onAttach: () => Promise<void>;
  onContinue: () => Promise<void>;
};

function PolicySummary({ catalog }: { catalog: CatalogData }) {
  const policy = catalog.policy;
  return (
    <dl className="policy-summary">
      <div><dt>Theme</dt><dd>{policy.theme}</dd></div>
      <div><dt>Size</dt><dd>{policy.size}px</dd></div>
      <div><dt>Stroke</dt><dd>{policy.strokeWidth}px</dd></div>
      <div><dt>Linecap</dt><dd>{policy.strokeLinecap}</dd></div>
      <div><dt>Linejoin</dt><dd>{policy.strokeLinejoin}</dd></div>
      <div><dt>Context</dt><dd>{policy.context ?? "Default"}</dd></div>
    </dl>
  );
}

export function Inspector(props: Props) {
  const { selected, catalog, runtime, actionState } = props;
  if (selected === null || catalog === null) {
    return <aside className="inspector inspector-empty">Select an icon to preview it</aside>;
  }

  return (
    <aside className="inspector">
      <div className="preview-panel">
        <img src={svgDataUri(selected.asset.svg)} alt={`${selected.name} preview`} />
        <div>
          <h2>{selected.name}</h2>
          <p>{selected.title}</p>
          <code>{selected.id}</code>
        </div>
      </div>
      <div className="action-stack" aria-label="Human export actions">
        <button className="primary-action" type="button" disabled={actionState !== "idle"} onClick={() => void props.onCopySvg()}>
          {actionState === "copying-svg" ? "Copying…" : "Copy SVG"}
        </button>
        <button type="button" disabled={actionState !== "idle"} onClick={() => void props.onDownload()}>
          {actionState === "downloading" ? "Downloading…" : "Download"}
        </button>
        <button type="button" disabled={actionState !== "idle"} onClick={() => void props.onCopyForAgent()}>
          {actionState === "copying-agent" ? "Copying…" : "Copy for Agent"}
        </button>
      </div>
      {runtime.mode === "embedded" && (runtime.canAttach || runtime.canContinue) && (
        <section className="agent-actions" aria-label="Agent actions">
          <h3>Agent</h3>
          {runtime.canAttach && (
            <button type="button" disabled={actionState !== "idle"} onClick={() => void props.onAttach()}>
              {actionState === "attaching" ? "Attaching…" : "Attach to conversation"}
            </button>
          )}
          {runtime.canContinue && (
            <button className="continue-action" type="button" disabled={actionState !== "idle"} onClick={() => void props.onContinue()}>
              {actionState === "continuing" ? "Sending…" : "Select & continue"}
            </button>
          )}
        </section>
      )}
      <PolicySummary catalog={catalog} />
    </aside>
  );
}

export type { ActionState };
