import {
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// D1 transport security for the loopback operator API (Step 981 sections
// 10-12, 14). Everything here is local deployment policy: Host and Origin
// allowlists for the bound loopback port, and per-launch token
// authentication. Application services never see any of it.

export const OPERATOR_TOKEN_BYTES =
  32;

export const MAX_REQUEST_TARGET_LENGTH =
  2048;

const BEARER_PREFIX =
  "Bearer ";

const TOKEN_PATTERN =
  /^[0-9a-f]{64}$/;

// The only value handlers receive after authentication. It deliberately
// carries no token bytes, so a future identity provider can replace the
// local authenticator without touching handlers or application services.
export type OperatorRequestContext =
  Readonly<{
    authentication:
      "LOCAL_LAUNCH_TOKEN";
  }>;

export type OperatorAuthenticator =
  (
    authorizationHeaderValues:
      readonly string[],
  ) => OperatorRequestContext | null;

export type SecurityRejection =
  Readonly<{
    status: 400 | 401 | 403;
    code: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN";
  }>;

const FORBIDDEN:
  SecurityRejection =
    Object.freeze({
      status: 403,
      code: "FORBIDDEN",
    });

const BAD_REQUEST:
  SecurityRejection =
    Object.freeze({
      status: 400,
      code: "BAD_REQUEST",
    });

const LOCAL_LAUNCH_TOKEN_CONTEXT:
  OperatorRequestContext =
    Object.freeze({
      authentication:
        "LOCAL_LAUNCH_TOKEN",
    });

export function generateOperatorLaunchToken(): string {
  return randomBytes(
    OPERATOR_TOKEN_BYTES,
  ).toString(
    "hex",
  );
}

export function isOperatorLaunchToken(
  value:
    unknown,
): value is string {
  return typeof value ===
      "string" &&
    TOKEN_PATTERN.test(
      value,
    );
}

// All values of one header name, in arrival order (Node folds or discards
// duplicates in req.headers, so rawHeaders is authoritative).
export function headerValues(
  rawHeaders:
    readonly string[],

  name:
    string,
): readonly string[] {
  const values:
    string[] =
      [];

  for (
    let index = 0;
    index + 1 < rawHeaders.length;
    index += 2
  ) {
    if (
      rawHeaders[index]?.toLowerCase() ===
      name
    ) {
      values.push(
        rawHeaders[index + 1] ?? "",
      );
    }
  }

  return values;
}

function allowedAuthorities(
  port:
    number,
): readonly string[] {
  return [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
  ];
}

// Exactly one Host, equal to 127.0.0.1:<bound port> or localhost:<bound port>.
// This defeats DNS rebinding: a rebound name never matches.
export function checkHost(
  rawHeaders:
    readonly string[],

  boundPort:
    number | null,
): SecurityRejection | null {
  const hosts =
    headerValues(
      rawHeaders,
      "host",
    );

  if (
    hosts.length >
    1
  ) {
    return BAD_REQUEST;
  }

  const host =
    hosts[0];

  if (
    boundPort ===
      null ||
    host ===
      undefined ||
    !allowedAuthorities(
      boundPort,
    ).includes(
      host,
    )
  ) {
    return FORBIDDEN;
  }

  return null;
}

// Absent Origin is allowed (non-browser clients and same-origin GET). A
// present Origin must be this server's own loopback origin; "null" and every
// other value are refused.
export function checkOrigin(
  rawHeaders:
    readonly string[],

  boundPort:
    number,
): SecurityRejection | null {
  const origins =
    headerValues(
      rawHeaders,
      "origin",
    );

  if (
    origins.length ===
    0
  ) {
    return null;
  }

  if (
    origins.length ===
      1 &&
    allowedAuthorities(
      boundPort,
    ).some(
      (authority) =>
        origins[0] ===
        `http://${authority}`,
    )
  ) {
    return null;
  }

  return FORBIDDEN;
}

// The token is captured once here and never leaves this closure.
export function createLocalTokenAuthenticator(
  token:
    string,
): OperatorAuthenticator {
  if (
    !isOperatorLaunchToken(
      token,
    )
  ) {
    throw new Error(
      "Operator launch token must be 64 lowercase hexadecimal characters.",
    );
  }

  const expected =
    Buffer.from(
      token,
      "utf8",
    );

  return (
    authorizationHeaderValues,
  ) => {
    if (
      authorizationHeaderValues.length !==
      1
    ) {
      return null;
    }

    const value =
      authorizationHeaderValues[0] ?? "";

    if (
      !value.startsWith(
        BEARER_PREFIX,
      )
    ) {
      return null;
    }

    const presented =
      value.slice(
        BEARER_PREFIX.length,
      );

    if (
      !isOperatorLaunchToken(
        presented,
      )
    ) {
      return null;
    }

    const candidate =
      Buffer.from(
        presented,
        "utf8",
      );

    if (
      candidate.length !==
        expected.length ||
      !timingSafeEqual(
        candidate,
        expected,
      )
    ) {
      return null;
    }

    return LOCAL_LAUNCH_TOKEN_CONTEXT;
  };
}

// Request target and body policy for a GET-only API: bounded length,
// origin-form path, and no request body of any kind.
export function checkRequestTarget(
  url:
    string | undefined,
): SecurityRejection | null {
  if (
    url ===
      undefined ||
    url.length >
      MAX_REQUEST_TARGET_LENGTH ||
    !url.startsWith(
      "/",
    )
  ) {
    return BAD_REQUEST;
  }

  return null;
}

export function checkNoRequestBody(
  rawHeaders:
    readonly string[],
): SecurityRejection | null {
  const contentLengths =
    headerValues(
      rawHeaders,
      "content-length",
    );

  if (
    headerValues(
      rawHeaders,
      "transfer-encoding",
    ).length >
      0 ||
    contentLengths.some(
      (value) =>
        value.trim() !==
        "0",
    )
  ) {
    return BAD_REQUEST;
  }

  return null;
}
