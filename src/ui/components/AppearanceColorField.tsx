import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SafeColorSchema } from "../../core/contracts.js";

type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

const COLOR_PRESETS = [
  "#111827",
  "#ffffff",
  "#1473e6",
  "#2f88ff",
  "#43ccf8",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
] as const;

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

function hexToHsl(value: string): HslColor {
  const hex = swatchValue(value).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    hue,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

function hslToHex({ hue, saturation, lightness }: HslColor): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (section < 1) [red, green] = [chroma, x];
  else if (section < 2) [red, green] = [x, chroma];
  else if (section < 3) [green, blue] = [chroma, x];
  else if (section < 4) [green, blue] = [x, chroma];
  else if (section < 5) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];
  const match = l - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

export type ColorSlot = "primary" | "secondary" | "innerStroke" | "innerFill";

type Props = {
  slot: ColorSlot;
  label: string;
  value: string;
  onCommit: (value: string) => void;
};

export function AppearanceColorField({ slot, label, value, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<HslColor>(() => hexToHsl(value));
  // Hex the editor was seeded from. The HSL editor can only approximate
  // non-hex values (currentColor, var(--token), keywords, alpha hex), so an
  // untouched editor must never write its approximation back as a commit.
  const seedHex = useRef(hslToHex(hexToHsl(value)));
  const trigger = useRef<HTMLButtonElement>(null);
  const editorId = `appearance-color-editor-${slot}`;

  useEffect(() => {
    setDraft(value);
    const nextEditor = hexToHsl(value);
    setEditor(nextEditor);
    seedHex.current = hslToHex(nextEditor);
    setError(null);
  }, [value]);

  const commitText = () => {
    const parsed = SafeColorSchema.safeParse(draft);
    if (!parsed.success) {
      setError("Use hex, currentColor, var(--token), or a CSS color.");
      return;
    }
    setDraft(parsed.data);
    setEditor(hexToHsl(parsed.data));
    setError(null);
    if (parsed.data !== value) onCommit(parsed.data);
  };

  const closeEditor = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus());
  };

  const editorHex = hslToHex(editor);
  const editorDirty = editorHex !== seedHex.current;
  const swatchStyle = { "--swatch-color": swatchValue(draft) } as CSSProperties;

  return (
    <div className={`appearance-color-field${open ? " is-open" : ""}`}>
      <label htmlFor={`appearance-color-${slot}`}>{label}</label>
      <div className="appearance-color-control">
        <button
          ref={trigger}
          className="appearance-color-swatch"
          type="button"
          aria-label={`Edit ${label} color`}
          aria-expanded={open}
          aria-controls={editorId}
          style={swatchStyle}
          onClick={() => {
            const seed = hexToHsl(draft);
            setEditor(seed);
            seedHex.current = hslToHex(seed);
            setOpen((current) => !current);
          }}
        >
          <span aria-hidden="true" />
        </button>
        <input
          id={`appearance-color-${slot}`}
          type="text"
          value={draft}
          aria-invalid={error === null ? undefined : true}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(value);
              setError(null);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {error !== null && <span className="appearance-field-error" role="alert">{error}</span>}
      {open && (
        <div
          id={editorId}
          className="appearance-color-editor"
          role="region"
          aria-label={`${label} color editor`}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeEditor(true);
          }}
        >
          <header>
            <span className="color-editor-preview" style={{ backgroundColor: editorHex }} aria-hidden="true" />
            <strong>{editorHex}</strong>
            <button type="button" onClick={() => closeEditor(true)}>Close</button>
          </header>
          <label>
            <span>Hue <output>{Math.round(editor.hue)}°</output></span>
            <input
              className="hue-range"
              type="range"
              min={0}
              max={359}
              value={editor.hue}
              aria-label={`${label} hue`}
              onChange={(event) => setEditor((current) => ({ ...current, hue: Number(event.target.value) }))}
            />
          </label>
          <label>
            <span>Saturation <output>{Math.round(editor.saturation)}%</output></span>
            <input
              type="range"
              min={0}
              max={100}
              value={editor.saturation}
              aria-label={`${label} saturation`}
              onChange={(event) => setEditor((current) => ({ ...current, saturation: Number(event.target.value) }))}
            />
          </label>
          <label>
            <span>Lightness <output>{Math.round(editor.lightness)}%</output></span>
            <input
              type="range"
              min={0}
              max={100}
              value={editor.lightness}
              aria-label={`${label} lightness`}
              onChange={(event) => setEditor((current) => ({ ...current, lightness: Number(event.target.value) }))}
            />
          </label>
          <div className="color-presets" aria-label="Color presets">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`Use ${preset}`}
                title={preset}
                style={{ backgroundColor: preset }}
                onClick={() => setEditor(hexToHsl(preset))}
              />
            ))}
          </div>
          <button
            className="color-apply"
            type="button"
            disabled={!editorDirty}
            onClick={() => {
              setDraft(editorHex);
              setError(null);
              onCommit(editorHex);
              closeEditor(true);
            }}
          >
            Apply color
          </button>
        </div>
      )}
    </div>
  );
}
