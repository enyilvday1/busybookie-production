import "../styles/tokens.css";
import "../styles/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReferencePage } from "./ReferencePage";

// Development-only entry (reference.html). Not a production build input.
const container = document.getElementById("root");

if (container === null) {
  throw new Error("Design system reference root element is missing.");
}

createRoot(container).render(
  <StrictMode>
    <ReferencePage />
  </StrictMode>,
);
