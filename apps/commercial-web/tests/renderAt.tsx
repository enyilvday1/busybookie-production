import { render } from "@testing-library/react";

import { App } from "../src/App";

/** Renders the application as if the browser had loaded `path`. */
export function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  return render(<App />);
}

/** Heading levels in document order, e.g. [1, 2, 3, 3, 2]. */
export function headingLevels(root: ParentNode = document): number[] {
  return [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) => Number(heading.tagName.slice(1)));
}
