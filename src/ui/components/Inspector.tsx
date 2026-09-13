import type { CatalogItem, RenderStyle, RenderStyleOverride } from "../../core/contracts.js";
import type { PickerRuntime } from "../runtime-shared.js";
import { svgDataUri } from "../svg-data-uri.js";
import { useMessages } from "../messages.js";
import { AppearancePanel } from "./AppearancePanel.js";
import { LanguageSelect } from "./LanguageSelect.js";

type ActionState = "idle" | "copying-svg" | "copying-agent" | "copying-link" | "downloading" | "attaching" | "continuing" | "inserting";

type Props = {
  selected: CatalogItem | null;
  style: RenderStyle | null;
  context: string | null;
  hasOverride: boolean;
  renderPending: boolean;
  selectionReady: boolean;
  runtime: PickerRuntime;
  actionState: ActionState;
  onAppearanceChange: (patch: RenderStyleOverride) => void;
  onAppearanceReset: () => void;
  onCopySvg: () => Promise<void>;
  onCopyLink: () => Promise<void>;
  onDownload: () => Promise<void>;
  onCopyForAgent: () => Promise<void>;
  onAttach: () => Promise<void>;
  onContinue: () => Promise<void>;
};

export function Inspector(props: Props) {
  const { selected, style, context, hasOverride, renderPending, runtime, actionState } = props;
  const { t, locale } = useMessages();
  if (selected === null || style === null) {
    return <aside className="inspector inspector-empty">{t("selectToPreview")}</aside>;
  }

  return (
    <aside className={`inspector${renderPending ? " is-rendering" : ""}`}>
      <div className="preview-panel">
        <div className="preview-art">
          <img src={svgDataUri(selected.asset.svg)} alt={`${selected.name} preview`} />
        </div>
        <div className="preview-meta">
          {locale === "zh-CN"
            ? <><h2>{selected.title}</h2><p>{selected.name}</p></>
            : <><h2>{selected.name}</h2><p>{selected.title}</p></>}
          <code>{selected.id}</code>
        </div>
      </div>
      <div className="action-stack" aria-label={t("humanExportActions")}>
        <button className="primary-action" type="button" disabled={!props.selectionReady || renderPending || actionState !== "idle"} onClick={() => void props.onCopySvg()}>
          {actionState === "copying-svg" ? t("copying") : t("copySvg")}
        </button>
        <div className="action-secondary">
          <button type="button" disabled={!props.selectionReady || renderPending || actionState !== "idle"} onClick={() => void props.onDownload()}>
            {actionState === "downloading" ? t("downloading") : t("download")}
          </button>
          <button type="button" disabled={!props.selectionReady || renderPending || actionState !== "idle"} onClick={() => void props.onCopyForAgent()}>
            {actionState === "copying-agent" ? t("copying") : t("copyForAgent")}
          </button>
        </div>
        {runtime.mode === "standalone" && (
          <button type="button" disabled={!props.selectionReady || renderPending || actionState !== "idle"} onClick={() => void props.onCopyLink()}>
            {actionState === "copying-link" ? t("copying") : t("copyIconLink")}
          </button>
        )}
      </div>
      {runtime.mode === "embedded" && (runtime.canAttach || runtime.canContinue) && (
        <section className="agent-actions" aria-label={t("agentActions")}>
          <h3>{t("agentHeading")}</h3>
          {runtime.canAttach && (
            <button type="button" disabled={!props.selectionReady || renderPending || actionState !== "idle"} onClick={() => void props.onAttach()}>
              {actionState === "attaching" ? t("attaching") : t("attachToConversation")}
            </button>
          )}
          {runtime.canContinue && (
            <button className="continue-action" type="button" disabled={!props.selectionReady || renderPending || actionState !== "idle"} onClick={() => void props.onContinue()}>
              {actionState === "continuing" ? t("sending") : t("selectAndContinue")}
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
      <LanguageSelect />
    </aside>
  );
}

export type { ActionState };
