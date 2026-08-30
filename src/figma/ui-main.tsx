import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../ui/App.js";
import "../ui/styles.css";
import { FigmaRuntime } from "./runtime.js";
import { MessagesProvider, type PreferenceStorage } from "../ui/messages.js";
import { resolveLocale, translate } from "../ui/i18n.js";
import type { FigmaRuntimeState } from "../ui/runtime-shared.js";

const runtime = new FigmaRuntime();

// The locale preference round-trips through the plugin main thread's
// clientStorage, so the storage bridge forwards writes and hydration arrives
// through the runtime state instead of a local read.
const figmaLocaleStorage: PreferenceStorage = {
  read: () => "system",
  write: (preference) => runtime.saveFigmaLocale(preference),
};

function FigmaApp() {
  const [externalLocale, setExternalLocale] = useState<FigmaRuntimeState["locale"] | null>(null);
  useEffect(() => runtime.onFigmaState((state) => {
    if (state.hydrated) setExternalLocale(state.locale);
  }), []);

  return (
    <MessagesProvider storage={figmaLocaleStorage} externalPreference={externalLocale}>
      <App runtime={runtime} />
    </MessagesProvider>
  );
}

const root = createRoot(document.getElementById("root")!);

try {
  root.render(<StrictMode><FigmaApp /></StrictMode>);
} catch (error) {
  const startupLocale = resolveLocale("system", navigator.languages);
  const message = error instanceof Error ? error.message : translate(startupLocale, "figmaStartupFailed");
  root.render(<main className="startup-error" role="alert"><h1>Armorial</h1><p>{message}</p></main>);
}
