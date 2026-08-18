import { useEffect, useState } from "react";
import {
  SafeColorSchema,
  type RenderStyle,
  type RenderStyleOverride,
  type Theme,
} from "../../core/contracts.js";

type ColorSlot = "primary" | "secondary" | "innerStroke" | "innerFill";

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

function swatchValue(value: string): string {
  const lower = value.toLocaleLowerCase("en-US");
  if (lower === "currentcolor") return "#111827";
  const match = lower.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (match === null) return "#ffffff";
  const digits = match[1] ?? "";
  if (digits.length === 3 || digits.length === 4) {
    return `#${digits.slice(0, 3).split("").map((character) => character.repeat(2)).join("")}`;
  }
  return `#${digits.slice(0, 6)}`;
}

type NumberInputProps = {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  onCommit: (value: number) => void;
};

function BoundedNumberInput(props: NumberInputProps) {
  const { ariaLabel, value, min, max, step, integer = false, onCommit } = props;
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(String(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (
      draft.trim().length === 0
      || !Number.isFinite(parsed)
      || parsed < min
      || parsed > max
      || (integer && !Number.isInteger(parsed))
    ) {
      setError(integer ? `Use a whole number from ${min} to ${max}.` : `Use ${min} to ${max}.`);
      return;
    }
    setDraft(String(parsed));
    setError(null);
    // Blurring an unchanged field is not an appearance change.
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <>
      <input
        className="appearance-number"
        type="number"
        aria-label={ariaLabel}
        aria-invalid={error === null ? undefined : true}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(value));
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error !== null && <span className="appearance-field-error" role="alert">{error}</span>}
    </>
  );
}

type ColorInputProps = {
  slot: ColorSlot;
  label: string;
  value: string;
  onCommit: (value: string) => void;
};

function ColorInput({ slot, label, value, onCommit }: ColorInputProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    const parsed = SafeColorSchema.safeParse(draft);
    if (!parsed.success) {
      setError("Use hex, currentColor, var(--token), or a CSS color.");
      return;
    }
    setDraft(parsed.data);
    setError(null);
    // Blurring an unchanged field is not an appearance change.
    if (parsed.data !== value) onCommit(parsed.data);
  };

  return (
    <span className="appearance-color">
      <input
        type="color"
        aria-label={`${label} color`}
        value={swatchValue(value)}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
          onCommit(event.target.value);
        }}
      />
      <input
        id={`appearance-color-${slot}`}
        type="text"
        value={draft}
        aria-invalid={error === null ? undefined : true}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error !== null && <span className="appearance-field-error" role="alert">{error}</span>}
    </span>
  );
}

export function AppearancePanel({ style, context, hasOverride, isRendering, onChange, onReset }: Props) {
  return (
    <section className="appearance" aria-label="Appearance">
      <header className="appearance-head">
        <h3>Appearance</h3>
        <span className="appearance-head-actions">
          <span className="appearance-status" aria-live="polite">
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
      <div className="appearance-row">
        <label htmlFor="appearance-theme">Theme</label>
        <select
          id="appearance-theme"
          value={style.theme}
          onChange={(event) => onChange({ theme: event.target.value as Theme })}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className="appearance-row">
        <label htmlFor="appearance-size">Size</label>
        <span className="appearance-slider">
          <input
            id="appearance-size"
            type="range"
            min={8}
            max={96}
            step={1}
            value={Math.min(style.size, 96)}
            onChange={(event) => onChange({ size: Number(event.target.value) })}
          />
          <BoundedNumberInput
            ariaLabel="Size value"
            value={style.size}
            min={8}
            max={512}
            step={1}
            integer
            onCommit={(size) => onChange({ size })}
          />
        </span>
      </div>
      <div className="appearance-row">
        <label htmlFor="appearance-stroke">Stroke</label>
        <span className="appearance-slider">
          <input
            id="appearance-stroke"
            type="range"
            min={0.5}
            max={8}
            step={0.5}
            value={Math.min(style.strokeWidth, 8)}
            onChange={(event) => onChange({ strokeWidth: Number(event.target.value) })}
          />
          <BoundedNumberInput
            ariaLabel="Stroke value"
            value={style.strokeWidth}
            min={0.5}
            max={16}
            step={0.5}
            onCommit={(strokeWidth) => onChange({ strokeWidth })}
          />
        </span>
      </div>
      <div className="appearance-row appearance-row-pair">
        <span className="appearance-row-pair-item">
          <label htmlFor="appearance-linecap">Linecap</label>
          <select
            id="appearance-linecap"
            value={style.strokeLinecap}
            onChange={(event) => onChange({ strokeLinecap: event.target.value as typeof style.strokeLinecap })}
          >
            {LINECAP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </span>
        <span className="appearance-row-pair-item">
          <label htmlFor="appearance-linejoin">Linejoin</label>
          <select
            id="appearance-linejoin"
            value={style.strokeLinejoin}
            onChange={(event) => onChange({ strokeLinejoin: event.target.value as typeof style.strokeLinejoin })}
          >
            {LINEJOIN_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </span>
      </div>
      {COLOR_SLOTS.map(({ slot, label }) => (
        <div className="appearance-row" key={slot}>
          <label htmlFor={`appearance-color-${slot}`}>{label}</label>
          <ColorInput
            slot={slot}
            label={label}
            value={style.colors[slot]}
            onCommit={(color) => onChange({ colors: { [slot]: color } })}
          />
        </div>
      ))}
      <div className="appearance-context">Context: {context ?? "Default"}</div>
    </section>
  );
}
