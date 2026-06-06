import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./providers";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <AppProviders>
    <App />
  </AppProviders>,
);
