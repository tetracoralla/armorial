import { useEffect, useState } from "react";

type NumberInputProps = {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  onCommit: (value: number) => void;
};

export function BoundedNumberInput(props: NumberInputProps) {
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
