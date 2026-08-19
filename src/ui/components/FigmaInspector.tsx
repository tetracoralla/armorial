import { useEffect, useState } from "react";
import type { CatalogItem, RenderStyle, RenderStyleOverride } from "../../core/contracts.js";
import {
  FigmaInsertSettingsSchema,
  type FigmaInsertSettings,
} from "../../figma/protocol.js";
import type { FigmaPickerRuntime } from "../runtime.js";
import { svgDataUri } from "../svg-data-uri.js";
import { AppearancePanel } from "./AppearancePanel.js";
import type { ActionState } from "./Inspector.js";

type Props = {
  selected: CatalogItem | null;
  style: RenderStyle | null;
  hasOverride: boolean;
  renderPending: boolean;
  runtime: FigmaPickerRuntime;
  actionState: ActionState;
  onAppearanceChange: (patch: RenderStyleOverride) => void;
  onAppearanceReset: () => void;
  onInsert: () => Promise<void>;
};

export function FigmaInspector(props: Props) {
  const { runtime } = props;
  const [figmaState, setFigmaState] = useState(runtime.figmaState);

  useEffect(() => runtime.onFigmaState(setFigmaState), [runtime]);

  if (props.selected === null || props.style === null) {
    return <aside className="inspector inspector-empty">Select an icon to insert it</aside>;
  }

  const updateSettings = (patch: Partial<FigmaInsertSettings>) => {
    const next = FigmaInsertSettingsSchema.parse({ ...figmaState.settings, ...patch });
    setFigmaState((current) => ({ ...current, settings: next, error: null }));
    runtime.saveFigmaSettings(next);
  };
  const receipt = figmaState.lastReceipt;

  return (
    <aside className={`inspector${props.renderPending ? " is-rendering" : ""}`}>
      <div className="preview-panel figma-preview-panel">
        <img src={svgDataUri(props.selected.asset.svg)} alt={`${props.selected.name} preview`} />
        <div>
          <h2>{props.selected.name}</h2>
          <p>{props.selected.title}</p>
          <code>{props.selected.id}</code>
        </div>
      </div>
      <div className="action-stack figma-insert-actions" aria-label="Figma insert actions">
        <button
          className="primary-action"
          type="button"
          disabled={props.renderPending || props.actionState !== "idle"}
          onClick={() => void props.onInsert()}
        >
          {props.actionState === "inserting"
            ? "Inserting…"
            : figmaState.settings.createComponent
              ? "Insert component"
              : "Insert icon"}
        </button>
        <p>Drag any icon to place it precisely on the canvas.</p>
        <p className="figma-target">Page: {figmaState.pageName}</p>
      </div>
      <section className="figma-output" aria-label="Figma output">
        <header><h3>Figma output</h3></header>
        <label className="figma-setting-row">
          <span>Layer structure</span>
          <select
            value={figmaState.settings.layerStructure}
            onChange={(event) => updateSettings({
              layerStructure: event.target.value as FigmaInsertSettings["layerStructure"],
            })}
          >
            <option value="preserve">Preserve layers</option>
            <option value="flatten">Flatten to vector</option>
            <option value="union">Boolean union</option>
          </select>
        </label>
        <label className="figma-setting-row">
          <span>Layer name</span>
          <select
            value={figmaState.settings.layerName}
            onChange={(event) => updateSettings({
              layerName: event.target.value as FigmaInsertSettings["layerName"],
            })}
          >
            <option value="icon-name">Icon name</option>
            <option value="Vector">Vector</option>
            <option value="Union">Union</option>
          </select>
        </label>
        <label className="figma-toggle-row">
          <span>Outline strokes</span>
          <input
            type="checkbox"
            checked={figmaState.settings.outlineStroke}
            onChange={(event) => updateSettings({ outlineStroke: event.target.checked })}
          />
        </label>
        <label className="figma-toggle-row">
          <span>Create component</span>
          <input
            type="checkbox"
            checked={figmaState.settings.createComponent}
            onChange={(event) => updateSettings({ createComponent: event.target.checked })}
          />
        </label>
        <div className="figma-operation-status" aria-live="polite">
          {figmaState.error !== null
            ? <span className="is-error">{figmaState.error}</span>
            : receipt !== null
              ? <span>{receipt.nodeName} · {receipt.nodeType.toLocaleLowerCase("en-US")}</span>
              : null}
        </div>
      </section>
      <AppearancePanel
        style={props.style}
        context={null}
        hasOverride={props.hasOverride}
        isRendering={props.renderPending}
        onChange={props.onAppearanceChange}
        onReset={props.onAppearanceReset}
      />
    </aside>
  );
}
