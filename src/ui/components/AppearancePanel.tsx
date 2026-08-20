import { memo } from "react";
import {
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  type RenderStyle,
  type RenderStyleOverride,
  type Theme,
} from "../../core/contracts.js";
import { AppearanceColorField, type ColorSlot } from "./AppearanceColorField.js";
import { AppearanceRangeField } from "./AppearanceRangeField.js";

type Props = {
  style: RenderStyle;
  context: string | null;
  hasOverride: boolean;
  isRendering: boolean;
  onChange: (patch: RenderStyleOverride) => void;
  onReset: () => void;
};

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "outline", label: "Outline" },
  { value: "filled", label: "Filled" },
  { value: "two-tone", label: "Two-tone" },
  { value: "multi-color", label: "Multi-color" },
];

const LINECAP_OPTIONS = ["butt", "round", "square"] as const;
const LINEJOIN_OPTIONS = ["miter", "round", "bevel"] as const;

const COLOR_SLOTS: ReadonlyArray<{ slot: ColorSlot; label: string }> = [
  { slot: "primary", label: "Primary" },
  { slot: "secondary", label: "Secondary" },
  { slot: "innerStroke", label: "Inner stroke" },
  { slot: "innerFill", label: "Inner fill" },
];

export const AppearancePanel = memo(function AppearancePanel({ style, context, hasOverride, isRendering, onChange, onReset }: Props) {
  return (
    <section className="appearance" aria-label="Appearance">
      <header className="appearance-head">
        <h3>Appearance</h3>
        <span className="appearance-head-actions">
          <span
            className={`appearance-status${hasOverride ? " is-modified" : ""}`}
            aria-live="polite"
          >
            {isRendering ? "Rendering…" : hasOverride ? "Modified" : ""}
          </span>
          <button
            className="appearance-reset"
            type="button"
            disabled={!hasOverride}
            onClick={onReset}
          >
            Reset
          </button>
        </span>
      </header>

      <div className="appearance-section">
        <h4>Form</h4>
        <label className="appearance-select-field" htmlFor="appearance-theme">
          <span>Theme</span>
          <select
            id="appearance-theme"
            value={style.theme}
            onChange={(event) => onChange({ theme: event.target.value as Theme })}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="appearance-range-grid">
          <AppearanceRangeField
            id="appearance-size"
            label="Size"
            ariaLabel="Size value"
            value={style.size}
            sliderMin={8}
            sliderMax={96}
            min={8}
            max={512}
            step={1}
            integer
            onCommit={(size) => onChange({ size })}
          />
          <AppearanceRangeField
            id="appearance-stroke"
            label="Stroke"
            ariaLabel="Stroke value"
            value={style.strokeWidth}
            sliderMin={MIN_STROKE_WIDTH}
            sliderMax={MAX_STROKE_WIDTH}
            min={MIN_STROKE_WIDTH}
            max={MAX_STROKE_WIDTH}
            step={1}
            integer
            onCommit={(strokeWidth) => onChange({ strokeWidth })}
          />
        </div>
        <div className="appearance-row-pair">
          <label className="appearance-select-field" htmlFor="appearance-linecap">
            <span>Linecap</span>
            <select
              id="appearance-linecap"
              value={style.strokeLinecap}
              onChange={(event) => onChange({ strokeLinecap: event.target.value as typeof style.strokeLinecap })}
            >
              {LINECAP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="appearance-select-field" htmlFor="appearance-linejoin">
            <span>Linejoin</span>
            <select
              id="appearance-linejoin"
              value={style.strokeLinejoin}
              onChange={(event) => onChange({ strokeLinejoin: event.target.value as typeof style.strokeLinejoin })}
            >
              {LINEJOIN_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="appearance-section appearance-color-section">
        <h4>Color</h4>
        <div className="appearance-color-grid">
          {COLOR_SLOTS.map(({ slot, label }) => (
            <AppearanceColorField
              key={slot}
              slot={slot}
              label={label}
              value={style.colors[slot]}
              onCommit={(color) => onChange({ colors: { [slot]: color } })}
            />
          ))}
        </div>
      </div>

      <div className="appearance-context">
        <span>Policy context</span>
        <strong>{context ?? "Default"}</strong>
      </div>
    </section>
  );
});
