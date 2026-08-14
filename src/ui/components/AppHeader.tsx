import type { PickerRuntime } from "../runtime.js";

export function AppHeader({ runtime }: { runtime: PickerRuntime }) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><span /></span>
        <span>Icon SVG Select</span>
      </div>
      <div className="header-actions">
        {runtime.canFullscreen && (
          <button className="quiet-button" type="button" onClick={() => void runtime.requestFullscreen()}>
            Full screen
          </button>
        )}
      </div>
    </header>
  );
}
