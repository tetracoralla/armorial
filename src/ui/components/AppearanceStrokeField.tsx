import { useRef, type KeyboardEvent } from "react";
import { useMessages } from "../messages.js";
import { MAX_STROKE_WIDTH, MIN_STROKE_WIDTH, type RenderStyleOverride } from "../../core/contracts.js";

type Props = {
  value: number;
  onChange: (patch: RenderStyleOverride) => void;
};

// The stroke weight is a four-step integer scale (IconPark 1–4). A slider on
// such a narrow range has dead zones while dragging, so the weight is a
// segmented control: one tap per step, current step highlighted.
export function AppearanceStrokeField({ value, onChange }: Props) {
  const { t } = useMessages();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const steps: number[] = [];
  for (let weight = MIN_STROKE_WIDTH; weight <= MAX_STROKE_WIDTH; weight += 1) steps.push(weight);

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, weight: number) => {
    const currentIndex = steps.indexOf(weight);
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + steps.length) % steps.length;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % steps.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = steps.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextWeight = steps[nextIndex];
    if (nextWeight === undefined) return;
    onChange({ strokeWidth: nextWeight });
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="appearance-range-field">
      <div className="appearance-field-head">
        <span id="appearance-stroke-label">{t("stroke")}</span>
      </div>
      <div
        className="appearance-segmented"
        role="radiogroup"
        aria-label={t("strokeValue")}
      >
        {steps.map((weight) => (
          <button
            key={weight}
            type="button"
            role="radio"
            aria-checked={value === weight}
            tabIndex={value === weight ? 0 : -1}
            className={value === weight ? "is-selected" : ""}
            ref={(element) => { buttonRefs.current[weight - MIN_STROKE_WIDTH] = element; }}
            onClick={() => onChange({ strokeWidth: weight })}
            onKeyDown={(event) => moveSelection(event, weight)}
          >
            {weight}
          </button>
        ))}
      </div>
    </div>
  );
}
