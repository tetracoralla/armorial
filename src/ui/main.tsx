import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createPickerRuntime } from "./runtime.js";
import { localStoragePreferenceStorage, MessagesProvider } from "./messages.js";
import { resolveLocale, translate } from "./i18n.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

createPickerRuntime()
  .then((runtime) => {
    root.render(
      <StrictMode>
        <MessagesProvider storage={localStoragePreferenceStorage()}>
          <App runtime={runtime} />
        </MessagesProvider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    const startupLocale = resolveLocale("system", navigator.languages);
    const message = error instanceof Error ? error.message : translate(startupLocale, "pickerStartupFailed");
    root.render(<main className="startup-error" role="alert"><h1>Armorial</h1><p>{message}</p></main>);
  });
