import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createPickerRuntime } from "./runtime.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

createPickerRuntime()
  .then((runtime) => {
    root.render(<StrictMode><App runtime={runtime} /></StrictMode>);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The icon picker could not start.";
    root.render(<main className="startup-error" role="alert"><h1>Armorial</h1><p>{message}</p></main>);
  });
