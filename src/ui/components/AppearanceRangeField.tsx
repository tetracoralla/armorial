import { useEffect, useRef, useState } from "react";
import { BoundedNumberInput } from "./BoundedNumberInput.js";

type Props = {
  id: string;
  label: string;
  ariaLabel: string;
  value: number;
  sliderMin: number;
  sliderMax: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  onCommit: (value: number) => void;
};

const RANGE_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp"]);

export function AppearanceRangeField(props: Props) {
  const {
    id,
    label,
    ariaLabel,
    value,
    sliderMin,
    sliderMax,
    min,
    max,
    step,
    integer = false,
    onCommit,
  } = props;
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);

  useEffect(() => {
    setDraft(value);
    lastCommitted.current = value;
  }, [value]);

  const commitRange = () => {
    if (draft === lastCommitted.current) return;
    lastCommitted.current = draft;
    onCommit(draft);
  };

  return (
    <div className="appearance-range-field">
      <div className="appearance-field-head">
        <label htmlFor={id}>{label}</label>
        <BoundedNumberInput
          ariaLabel={ariaLabel}
          value={draft}
          min={min}
          max={max}
          step={step}
          integer={integer}
          onCommit={(next) => {
            setDraft(next);
            lastCommitted.current = next;
            onCommit(next);
          }}
        />
      </div>
      <input
        id={id}
        className="appearance-range"
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step}
        value={Math.min(Math.max(draft, sliderMin), sliderMax)}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commitRange}
        onBlur={commitRange}
        onKeyUp={(event) => {
          if (RANGE_KEYS.has(event.key)) commitRange();
        }}
      />
    </div>
  );
}
