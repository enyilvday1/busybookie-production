import { productIdentity } from "../../productIdentity";

/**
 * Replaceable wordmark area. The mark is a neutral geometric placeholder and
 * the name comes from productIdentity; neither encodes a final brand.
 */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark__mark" aria-hidden="true" />
      <span className="wordmark__name">{productIdentity.name}</span>
    </span>
  );
}
