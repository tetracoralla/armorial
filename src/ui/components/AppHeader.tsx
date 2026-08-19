import type { PickerRuntime } from "../runtime.js";

type Props = {
  runtime: PickerRuntime;
  figmaCompact?: boolean;
  onFigmaCompactToggle?: () => void;
};

export function AppHeader({ runtime, figmaCompact, onFigmaCompactToggle }: Props) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><span /></span>
        <span>Armorial</span>
      </div>
      <div className="header-actions">
        {onFigmaCompactToggle !== undefined && (
          <button className="quiet-button" type="button" onClick={onFigmaCompactToggle}>
            {figmaCompact ? "Settings" : "Drag mode"}
          </button>
        )}
        {runtime.canFullscreen && (
          <button
            className="quiet-button"
            type="button"
            onClick={() => {
              void runtime.requestFullscreen().catch(() => undefined);
            }}
          >
            Full screen
          </button>
        )}
      </div>
    </header>
  );
}
