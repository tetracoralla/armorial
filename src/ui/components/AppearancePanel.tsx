import { memo } from "react";
import {
  type RenderStyle,
  type RenderStyleOverride,
  type Theme,
} from "../../core/contracts.js";
import { useMessages } from "../messages.js";
import { AppearanceColorField, type ColorSlot } from "./AppearanceColorField.js";
import { AppearanceRangeField } from "./AppearanceRangeField.js";
import { AppearanceStrokeField } from "./AppearanceStrokeField.js";

type Props = {
  style: RenderStyle;
  context: string | null;
  hasOverride: boolean;
  isRendering: boolean;
  onChange: (patch: RenderStyleOverride) => void;
  onReset: () => void;
};

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; key: "themeOutline" | "themeFilled" | "themeTwoTone" | "themeMultiColor" }> = [
  { value: "outline", key: "themeOutline" },
  { value: "filled", key: "themeFilled" },
  { value: "two-tone", key: "themeTwoTone" },
  { value: "multi-color", key: "themeMultiColor" },
];

const LINECAP_OPTIONS = [
  { value: "butt", key: "capButt" },
  { value: "round", key: "capRound" },
  { value: "square", key: "capSquare" },
] as const;
const LINEJOIN_OPTIONS = [
  { value: "miter", key: "joinMiter" },
  { value: "round", key: "joinRound" },
  { value: "bevel", key: "joinBevel" },
] as const;

const COLOR_SLOTS: ReadonlyArray<{ slot: ColorSlot; key: "primary" | "secondary" | "innerStroke" | "innerFill" }> = [
  { slot: "primary", key: "primary" },
  { slot: "secondary", key: "secondary" },
  { slot: "innerStroke", key: "innerStroke" },
  { slot: "innerFill", key: "innerFill" },
];

export const AppearancePanel = memo(function AppearancePanel({ style, context, hasOverride, isRendering, onChange, onReset }: Props) {
  const { t } = useMessages();
  return (
    <section className="appearance" aria-label={t("appearance")}>
      <header className="appearance-head">
        <h3>{t("appearance")}</h3>
        <span className="appearance-head-actions">
          <span
            className={`appearance-status${hasOverride ? " is-modified" : ""}`}
            aria-live="polite"
          >
            {isRendering ? t("rendering") : hasOverride ? t("modified") : ""}
          </span>
          <button
            className="appearance-reset"
            type="button"
            disabled={!hasOverride}
            onClick={onReset}
          >
            {t("reset")}
          </button>
        </span>
      </header>

      <div className="appearance-section">
        <h4>{t("formSection")}</h4>
        <label className="appearance-select-field" htmlFor="appearance-theme">
          <span>{t("theme")}</span>
          <select
            id="appearance-theme"
            value={style.theme}
            onChange={(event) => onChange({ theme: event.target.value as Theme })}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.key)}</option>
            ))}
          </select>
        </label>
        <div className="appearance-range-grid">
          <AppearanceRangeField
            id="appearance-size"
            label={t("size")}
            ariaLabel={t("sizeValue")}
            value={style.size}
            sliderMin={8}
            sliderMax={96}
            min={8}
            max={512}
            step={1}
            integer
            onCommit={(size) => onChange({ size })}
          />
          <AppearanceStrokeField value={style.strokeWidth} onChange={onChange} />
        </div>
        <div className="appearance-row-pair">
          <label className="appearance-select-field" htmlFor="appearance-linecap">
            <span>{t("linecap")}</span>
            <select
              id="appearance-linecap"
              value={style.strokeLinecap}
              onChange={(event) => onChange({ strokeLinecap: event.target.value as typeof style.strokeLinecap })}
            >
              {LINECAP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.key)}</option>
              ))}
            </select>
          </label>
          <label className="appearance-select-field" htmlFor="appearance-linejoin">
            <span>{t("linejoin")}</span>
            <select
              id="appearance-linejoin"
              value={style.strokeLinejoin}
              onChange={(event) => onChange({ strokeLinejoin: event.target.value as typeof style.strokeLinejoin })}
            >
              {LINEJOIN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.key)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="appearance-section appearance-color-section">
        <h4>{t("colorSection")}</h4>
        <div className="appearance-color-grid">
          {COLOR_SLOTS.map(({ slot, key }) => (
            <AppearanceColorField
              key={slot}
              slot={slot}
              label={t(key)}
              value={style.colors[slot]}
              onCommit={(color) => onChange({ colors: { [slot]: color } })}
            />
          ))}
        </div>
      </div>

      {context !== null && (
        <div className="appearance-context">
          <span>{t("policyContext")}</span>
          <strong>{context}</strong>
        </div>
      )}
    </section>
  );
});
