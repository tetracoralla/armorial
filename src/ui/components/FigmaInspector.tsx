import { useEffect, useState } from "react";
import type { CatalogItem, RenderStyle, RenderStyleOverride } from "../../core/contracts.js";
import {
  FigmaInsertSettingsSchema,
  type FigmaInsertSettings,
} from "../../figma/protocol.js";
import type { FigmaPickerRuntime } from "../runtime-shared.js";
import { svgDataUri } from "../svg-data-uri.js";
import { useMessages } from "../messages.js";
import { AppearancePanel } from "./AppearancePanel.js";
import { LanguageSelect } from "./LanguageSelect.js";
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
  const { t, locale } = useMessages();
  const [figmaState, setFigmaState] = useState(runtime.figmaState);

  useEffect(() => runtime.onFigmaState(setFigmaState), [runtime]);

  if (props.selected === null || props.style === null) {
    return <aside className="inspector inspector-empty">{t("selectToInsert")}</aside>;
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
        <div className="preview-art">
          <img src={svgDataUri(props.selected.asset.svg)} alt={`${props.selected.name} preview`} />
        </div>
        <div className="preview-meta">
          {/* Chinese-first surface: the localized title leads, the catalog
              name stays as the secondary identifier. */}
          {locale === "zh-CN"
            ? <><h2>{props.selected.title}</h2><p>{props.selected.name}</p></>
            : <><h2>{props.selected.name}</h2><p>{props.selected.title}</p></>}
        </div>
      </div>
      <div className="action-stack figma-insert-actions" aria-label={t("figmaInsertActions")}>
        <button
          className="primary-action"
          type="button"
          disabled={props.renderPending || props.actionState !== "idle"}
          onClick={() => void props.onInsert()}
        >
          {props.actionState === "inserting"
            ? t("inserting")
            : figmaState.settings.createComponent
              ? t("insertComponent")
              : t("insertIcon")}
        </button>
        <p>{t("dragHint")}</p>
      </div>
      <section className="figma-output" aria-label={t("figmaOutput")}>
        <header><h3>{t("figmaOutput")}</h3></header>
        <label className="figma-setting-row">
          <span>{t("layerStructure")}</span>
          <select
            value={figmaState.settings.layerStructure}
            onChange={(event) => updateSettings({
              layerStructure: event.target.value as FigmaInsertSettings["layerStructure"],
            })}
          >
            <option value="preserve">{t("preserveLayers")}</option>
            <option value="flatten">{t("flattenToVector")}</option>
            <option value="union">{t("booleanUnion")}</option>
          </select>
        </label>
        <label className="figma-setting-row">
          <span>{t("layerName")}</span>
          <select
            value={figmaState.settings.layerName}
            onChange={(event) => updateSettings({
              layerName: event.target.value as FigmaInsertSettings["layerName"],
            })}
          >
            <option value="icon-name">{t("iconNameOption")}</option>
            <option value="Vector">Vector</option>
            <option value="Union">Union</option>
          </select>
        </label>
        <label className="figma-toggle-row">
          <span>{t("outlineStrokes")}</span>
          <input
            type="checkbox"
            checked={figmaState.settings.outlineStroke}
            onChange={(event) => updateSettings({ outlineStroke: event.target.checked })}
          />
        </label>
        <label className="figma-toggle-row">
          <span>{t("createComponent")}</span>
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
      <LanguageSelect />
    </aside>
  );
}
