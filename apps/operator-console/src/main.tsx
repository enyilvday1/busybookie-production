import "./styles/tokens.css";
import "./styles/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("Operator console root element is missing.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
