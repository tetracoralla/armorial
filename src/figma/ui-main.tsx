import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../ui/App.js";
import "../ui/styles.css";
import { FigmaRuntime } from "./runtime.js";

const root = createRoot(document.getElementById("root")!);

try {
  root.render(<StrictMode><App runtime={new FigmaRuntime()} /></StrictMode>);
} catch (error) {
  const message = error instanceof Error ? error.message : "The Figma plugin could not start.";
  root.render(<main className="startup-error" role="alert"><h1>Armorial</h1><p>{message}</p></main>);
}
