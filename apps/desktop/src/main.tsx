import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { bootstrap } from "./app/bootstrap";
import { AppProviders } from "./app/providers";
import "./styles.css";

const app = bootstrap();
const root = createRoot(document.getElementById("root")!);

root.render(
  <StrictMode>
    <AppProviders services={app.services}>
      <App />
    </AppProviders>
  </StrictMode>,
);

import.meta.hot?.dispose(() => {
  root.unmount();
  app.dispose();
});
