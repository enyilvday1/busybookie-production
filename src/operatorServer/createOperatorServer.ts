import {
  randomUUID,
} from "node:crypto";

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  isCanonicalEpisodeId,
  listCanonicalEpisodes,
} from "../application/listCanonicalEpisodes.js";

import {
  createHealthDto,
  mapEpisodeDetailDto,
  mapEpisodeListDto,
} from "../application/operatorDtos.js";

import {
  readEpisodeProductionStatus,
} from "../application/readEpisodeProductionStatus.js";

import {
  checkHost,
  checkNoRequestBody,
  checkOrigin,
  checkRequestTarget,
  createLocalTokenAuthenticator,
  headerValues,
  type OperatorRequestContext,
} from "./operatorRequestSecurity.js";

import type {
  OperatorConsoleAssets,
  OperatorConsoleResource,
} from "./operatorConsoleAssets.js";

// D1 read-only operator HTTP adapter (Step 981). Three GET routes over the
// transport-agnostic application services; no mutation, no CLI, no provider,
// no FFmpeg. Nothing listens until startOperatorServer is called.
// D3A (Step 1005): paths outside the /api namespace serve the built operator
// console from an in-memory map, without the bearer token; the /api namespace
// keeps the D1 pipeline unchanged.

export type OperatorServerDependencies =
  Readonly<{
    listCanonicalEpisodes:
      typeof listCanonicalEpisodes;

    readEpisodeProductionStatus:
      typeof readEpisodeProductionStatus;

    now:
      () => Date;

    randomRequestId:
      () => string;
  }>;

export type CreateOperatorServerOptions =
  Readonly<{
    token:
      string;

    dependencies?:
      Partial<OperatorServerDependencies>;

    // Local diagnostic stream (stderr by default). Never receives the token,
    // request headers or response bodies.
    log?:
      (text: string) => void;

    // Built console served outside the /api namespace. Absent: API-only
    // server (every non-API path is 404).
    consoleAssets?:
      OperatorConsoleAssets;
  }>;

type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "STATE_UNAVAILABLE"
  | "INTERNAL_ERROR";

type RouteTemplate =
  | "/api/v1/operator/health"
  | "/api/v1/operator/episodes"
  | "/api/v1/operator/episodes/:episodeId";

type MatchedRoute =
  Readonly<{
    template: RouteTemplate;
    episodeId?: string;
  }>;

const ERROR_STATUS:
  Readonly<Record<ErrorCode, number>> =
    Object.freeze({
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      METHOD_NOT_ALLOWED: 405,
      STATE_UNAVAILABLE: 503,
      INTERNAL_ERROR: 500,
    });

const ERROR_MESSAGE:
  Readonly<Record<ErrorCode, string>> =
    Object.freeze({
      BAD_REQUEST:
        "The request is not valid for this API.",
      UNAUTHORIZED:
        "A valid operator token is required.",
      FORBIDDEN:
        "The request host or origin is not allowed.",
      NOT_FOUND:
        "Route not found.",
      METHOD_NOT_ALLOWED:
        "Only GET is supported for this route.",
      STATE_UNAVAILABLE:
        "Production state could not be read. See the operator server log for this request ID.",
      INTERNAL_ERROR:
        "An internal operator server error occurred. See the operator server log for this request ID.",
    });

const EPISODE_NOT_FOUND_MESSAGE =
  "Episode not found.";

const API_PREFIX =
  "/api/v1/operator";

const EPISODES_PATH =
  `${API_PREFIX}/episodes`;

const OPERATOR_API_NAMESPACE =
  "/api";

const SECURITY_HEADERS =
  Object.freeze({
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control":
      "no-store, private",
    "X-Content-Type-Options":
      "nosniff",
    "Referrer-Policy":
      "no-referrer",
    "Cross-Origin-Resource-Policy":
      "same-origin",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'",
  });

const SERVER_HEADERS_TIMEOUT_MS =
  10_000;

const SERVER_REQUEST_TIMEOUT_MS =
  120_000;

const SERVER_KEEP_ALIVE_TIMEOUT_MS =
  5_000;

const SERVER_MAX_CONNECTIONS =
  32;

const LOG_CAUSE_DEPTH =
  4;

const LOG_LINE_MAX_CODE_POINTS =
  300;

const LOG_MAX_LINES =
  6;

const LOG_TAIL_LINES =
  5;

const defaultDependencies:
  OperatorServerDependencies =
    Object.freeze({
      listCanonicalEpisodes:
        () =>
          listCanonicalEpisodes(),

      readEpisodeProductionStatus:
        (episodeId: string) =>
          readEpisodeProductionStatus(
            episodeId,
          ),

      now:
        () =>
          new Date(),

      randomRequestId:
        () =>
          randomUUID(),
    });

function writeStderr(
  text:
    string,
): void {
  process.stderr.write(
    text,
  );
}

// Bounded, stack-free description of an error chain for the local log only
// (Step 968 policy): only .message and .cause are read, each message keeps
// its first and last five normalized lines, each line is bounded to 300 code
// points, and causes are followed to depth 4 with identity cycle detection.
function normalizeMessageLines(
  message:
    unknown,
): readonly string[] {
  if (
    typeof message !==
    "string"
  ) {
    return [
      "(non-string message)",
    ];
  }

  const lines =
    message
      .split(
        /\r\n|\r|\n/,
      )
      .map(
        (line) =>
          line
            .replace(
              /[\u0000-\u001f\u007f]/g,
              " ",
            )
            .trim(),
      )
      .filter(
        (line) =>
          line.length >
          0,
      );

  if (
    lines.length ===
    0
  ) {
    return [
      "(empty message)",
    ];
  }

  const bound =
    (line: string) => {
      const codePoints =
        Array.from(
          line,
        );

      return codePoints.length >
        LOG_LINE_MAX_CODE_POINTS
        ? `${codePoints.slice(0, LOG_LINE_MAX_CODE_POINTS).join("")}...`
        : line;
    };

  return lines.length <=
    LOG_MAX_LINES
    ? lines.map(
        bound,
      )
    : [
        bound(
          lines[0] ?? "",
        ),
        `... ${lines.length - 1 - LOG_TAIL_LINES} lines omitted ...`,
        ...lines
          .slice(
            -LOG_TAIL_LINES,
          )
          .map(
            bound,
          ),
      ];
}

function isErrorValue(
  value:
    unknown,
): boolean | null {
  try {
    return value instanceof
      Error;
  } catch {
    return null;
  }
}

function describeType(
  value:
    unknown,
): string {
  return value ===
    null
    ? "null"
    : typeof value;
}

function messageLinesOf(
  error:
    Error,
): readonly string[] {
  try {
    return normalizeMessageLines(
      error.message,
    );
  } catch {
    return [
      "(message unavailable)",
    ];
  }
}

function labelled(
  label:
    string,

  lines:
    readonly string[],
): string[] {
  const [
    first,
    ...rest
  ] = lines;

  return [
    `${label}${first ?? ""}`,
    ...rest.map(
      (line) =>
        `  ${line}`,
    ),
  ];
}

export function formatOperatorErrorChain(
  error:
    unknown,
): readonly string[] {
  try {
    if (
      isErrorValue(
        error,
      ) !==
      true
    ) {
      return [
        `Reason: non-Error value thrown (type ${describeType(error)}); contents not shown.`,
      ];
    }

    const lines =
      labelled(
        "Reason: ",
        messageLinesOf(
          error as Error,
        ),
      );

    const visited =
      new Set<unknown>([
        error,
      ]);

    let current =
      error as Error;

    for (
      let depth = 1;
      ;
      depth += 1
    ) {
      let cause:
        unknown;

      try {
        cause =
          current.cause;
      } catch {
        lines.push(
          `Cause ${depth}: cause unavailable; traversal stopped.`,
        );

        break;
      }

      if (
        cause ===
        undefined
      ) {
        break;
      }

      if (
        depth >
        LOG_CAUSE_DEPTH
      ) {
        lines.push(
          `Causes beyond depth ${LOG_CAUSE_DEPTH} omitted.`,
        );

        break;
      }

      const causeIsError =
        isErrorValue(
          cause,
        );

      if (
        causeIsError ===
        null
      ) {
        lines.push(
          `Cause ${depth}: cause unavailable; traversal stopped.`,
        );

        break;
      }

      if (
        !causeIsError
      ) {
        lines.push(
          `Cause ${depth}: non-Error value (type ${describeType(cause)}); contents not shown.`,
        );

        break;
      }

      if (
        visited.has(
          cause,
        )
      ) {
        lines.push(
          `Cause ${depth}: cause cycle detected; traversal stopped.`,
        );

        break;
      }

      visited.add(
        cause,
      );

      lines.push(
        ...labelled(
          `Cause ${depth}: `,
          messageLinesOf(
            cause as Error,
          ),
        ),
      );

      current =
        cause as Error;
    }

    return lines;
  } catch {
    return [
      "Reason: the failure could not be described safely.",
    ];
  }
}

function matchRoute(
  pathname:
    string,
): MatchedRoute | null {
  if (
    pathname ===
    `${API_PREFIX}/health`
  ) {
    return {
      template:
        "/api/v1/operator/health",
    };
  }

  if (
    pathname ===
    EPISODES_PATH
  ) {
    return {
      template:
        "/api/v1/operator/episodes",
    };
  }

  if (
    pathname.startsWith(
      `${EPISODES_PATH}/`,
    )
  ) {
    const segment =
      pathname.slice(
        EPISODES_PATH.length +
          1,
      );

    if (
      segment.length >
        0 &&
      !segment.includes(
        "/",
      )
    ) {
      return {
        template:
          "/api/v1/operator/episodes/:episodeId",

        episodeId:
          segment,
      };
    }
  }

  return null;
}

// The undecoded path component (before the first "?"), compared literally:
// "/api" and everything below "/api/" is API territory; "/apiXYZ" is not.
function isOperatorApiPath(
  pathname:
    string,
): boolean {
  return pathname ===
      OPERATOR_API_NAMESPACE ||
    pathname.startsWith(
      `${OPERATOR_API_NAMESPACE}/`,
    );
}

function boundPortOf(
  server:
    Server,
): number | null {
  const address =
    server.address();

  return typeof address ===
      "object" &&
    address !==
      null
    ? address.port
    : null;
}

class StateUnavailableError extends Error {
  constructor(
    cause:
      unknown,
  ) {
    super(
      "A production read authority rejected.",
      {
        cause,
      },
    );

    this.name =
      "StateUnavailableError";
  }
}

async function readAuthority<T>(
  read:
    () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (
    error
  ) {
    throw new StateUnavailableError(
      error,
    );
  }
}

export function createOperatorServer(
  options:
    CreateOperatorServerOptions,
): Server {
  const authenticate =
    createLocalTokenAuthenticator(
      options.token,
    );

  const dependencies:
    OperatorServerDependencies =
      {
        ...defaultDependencies,
        ...options.dependencies,
      };

  const log =
    options.log ??
    writeStderr;

  // Host policy is enforced by checkHost (missing Host -> 403 with the D1
  // envelope), not by Node's bare built-in 400.
  const server =
    createServer({
      requireHostHeader:
        false,
    });

  function respond(
    response:
      ServerResponse,

    requestId:
      string,

    status:
      number,

    body:
      unknown,

    extraHeaders:
      Readonly<Record<string, string>> =
        {},
  ): void {
    if (
      response.headersSent
    ) {
      response.end();
      return;
    }

    const payload =
      JSON.stringify(
        body,
      );

    response.writeHead(
      status,
      {
        ...SECURITY_HEADERS,
        ...extraHeaders,
        "X-Request-Id":
          requestId,
        "Content-Length":
          String(
            Buffer.byteLength(
              payload,
            ),
          ),
      },
    );

    response.end(
      payload,
    );
  }

  // Console success responses use the console header policy only (never the
  // JSON SECURITY_HEADERS map).
  function respondConsoleResource(
    response:
      ServerResponse,

    requestId:
      string,

    resource:
      OperatorConsoleResource,
  ): void {
    if (
      response.headersSent
    ) {
      response.end();
      return;
    }

    response.writeHead(
      200,
      {
        ...resource.headers,
        "X-Request-Id":
          requestId,
      },
    );

    response.end(
      resource.body,
    );
  }

  function respondError(
    response:
      ServerResponse,

    requestId:
      string,

    code:
      ErrorCode,

    message:
      string =
        ERROR_MESSAGE[code],
  ): void {
    const extraHeaders:
      Record<string, string> =
        {};

    if (
      code ===
      "UNAUTHORIZED"
    ) {
      extraHeaders["WWW-Authenticate"] =
        'Bearer realm="busybookie-operator"';
    }

    if (
      code ===
      "METHOD_NOT_ALLOWED"
    ) {
      extraHeaders.Allow =
        "GET";
    }

    respond(
      response,
      requestId,
      ERROR_STATUS[code],
      {
        error: {
          code,
          message,
          requestId,
        },
      },
      extraHeaders,
    );
  }

  function logFailure(
    requestId:
      string,

    code:
      ErrorCode,

    method:
      string,

    route:
      string,

    error:
      unknown,
  ): void {
    try {
      const cause =
        error instanceof
          StateUnavailableError
          ? error.cause
          : error;

      log(
        [
          `${dependencies.now().toISOString()} ${requestId} ${code} ${method} ${route}`,
          ...formatOperatorErrorChain(
            cause,
          ).map(
            (line) =>
              `  ${line}`,
          ),
        ].join(
          "\n",
        ) +
          "\n",
      );
    } catch {
      // Logging must never change the response.
    }
  }

  async function handleRoute(
    route:
      MatchedRoute,

    context:
      OperatorRequestContext,
  ): Promise<
    | Readonly<{ status: 200; body: unknown }>
    | Readonly<{ notFound: string }>
    | Readonly<{ badRequest: true }>
  > {
    // Handlers receive only the opaque authentication context, never the
    // token; the read-only D1 routes need no further authorization.
    void context;

    switch (route.template) {
      case "/api/v1/operator/health":
        return {
          status: 200,
          body:
            createHealthDto(),
        };

      case "/api/v1/operator/episodes": {
        const listing =
          await readAuthority(
            () =>
              dependencies
                .listCanonicalEpisodes(),
          );

        return {
          status: 200,
          body:
            mapEpisodeListDto(
              listing,
            ),
        };
      }

      case "/api/v1/operator/episodes/:episodeId": {
        const episodeId =
          route.episodeId;

        if (
          !isCanonicalEpisodeId(
            episodeId,
          )
        ) {
          return {
            badRequest:
              true,
          };
        }

        // Only an exactly listed, valid canonical episode is evaluated.
        const listing =
          await readAuthority(
            () =>
              dependencies
                .listCanonicalEpisodes(),
          );

        if (
          !listing.some(
            (entry) =>
              entry.episodeId ===
                episodeId &&
              entry.manifest ===
                "VALID",
          )
        ) {
          return {
            notFound:
              EPISODE_NOT_FOUND_MESSAGE,
          };
        }

        const status =
          await readAuthority(
            () =>
              dependencies
                .readEpisodeProductionStatus(
                  episodeId,
                ),
          );

        return {
          status: 200,
          body:
            mapEpisodeDetailDto(
              status,
              dependencies.now(),
            ),
        };
      }
    }
  }

  async function handleRequest(
    request:
      IncomingMessage,

    response:
      ServerResponse,
  ): Promise<void> {
    let requestId =
      "";

    let routeLabel =
      "(unmatched)";

    try {
      requestId =
        dependencies.randomRequestId();

      const rawHeaders =
        request.rawHeaders;

      const boundPort =
        boundPortOf(
          server,
        );

      // 1. Host, 2. Origin, 3. request target: before anything else.
      const hostRejection =
        checkHost(
          rawHeaders,
          boundPort,
        );

      if (hostRejection) {
        respondError(
          response,
          requestId,
          hostRejection.code,
        );
        return;
      }

      const originRejection =
        checkOrigin(
          rawHeaders,
          boundPort as number,
        );

      if (originRejection) {
        respondError(
          response,
          requestId,
          originRejection.code,
        );
        return;
      }

      const targetRejection =
        checkRequestTarget(
          request.url,
        );

      if (targetRejection) {
        respondError(
          response,
          requestId,
          targetRejection.code,
        );
        return;
      }

      // 4. Classify the undecoded path component (before the first "?").
      const target =
        request.url as string;

      const queryIndex =
        target.indexOf(
          "?",
        );

      const pathname =
        queryIndex ===
          -1
          ? target
          : target.slice(
              0,
              queryIndex,
            );

      if (
        !isOperatorApiPath(
          pathname,
        )
      ) {
        // 5. Console UI: no authentication and no API handler is reachable
        //    from here; exact in-memory lookup only.
        if (
          options.consoleAssets ===
          undefined
        ) {
          respondError(
            response,
            requestId,
            "NOT_FOUND",
          );
          return;
        }

        if (
          request.method !==
          "GET"
        ) {
          respondError(
            response,
            requestId,
            "METHOD_NOT_ALLOWED",
          );
          return;
        }

        if (
          queryIndex !==
            -1 ||
          pathname.includes(
            "%",
          ) ||
          checkNoRequestBody(
            rawHeaders,
          )
        ) {
          respondError(
            response,
            requestId,
            "BAD_REQUEST",
          );
          return;
        }

        const resource =
          options.consoleAssets.lookup(
            pathname,
          );

        if (
          resource ===
          undefined
        ) {
          respondError(
            response,
            requestId,
            "NOT_FOUND",
          );
          return;
        }

        respondConsoleResource(
          response,
          requestId,
          resource,
        );
        return;
      }

      // 6. API namespace: authenticate once; only the opaque context
      //    continues. Never falls through to the console.
      const context =
        authenticate(
          headerValues(
            rawHeaders,
            "authorization",
          ),
        );

      if (
        context ===
        null
      ) {
        respondError(
          response,
          requestId,
          "UNAUTHORIZED",
        );
        return;
      }

      // 7. Route, 8. method, 9. query/percent/body.
      const route =
        matchRoute(
          pathname,
        );

      if (
        route ===
        null
      ) {
        respondError(
          response,
          requestId,
          "NOT_FOUND",
        );
        return;
      }

      routeLabel =
        route.template;

      if (
        request.method !==
        "GET"
      ) {
        respondError(
          response,
          requestId,
          "METHOD_NOT_ALLOWED",
        );
        return;
      }

      if (
        queryIndex !==
          -1 ||
        pathname.includes(
          "%",
        ) ||
        checkNoRequestBody(
          rawHeaders,
        )
      ) {
        respondError(
          response,
          requestId,
          "BAD_REQUEST",
        );
        return;
      }

      const outcome =
        await handleRoute(
          route,
          context,
        );

      if (
        "badRequest" in
        outcome
      ) {
        respondError(
          response,
          requestId,
          "BAD_REQUEST",
        );
        return;
      }

      if (
        "notFound" in
        outcome
      ) {
        respondError(
          response,
          requestId,
          "NOT_FOUND",
          outcome.notFound,
        );
        return;
      }

      respond(
        response,
        requestId,
        outcome.status,
        outcome.body,
      );
    } catch (
      error
    ) {
      const code:
        ErrorCode =
          error instanceof
            StateUnavailableError
            ? "STATE_UNAVAILABLE"
            : "INTERNAL_ERROR";

      logFailure(
        requestId,
        code,
        request.method ?? "(none)",
        routeLabel,
        error,
      );

      try {
        respondError(
          response,
          requestId,
          code,
        );
      } catch {
        response.destroy();
      }
    }
  }

  server.on(
    "request",
    (request, response) => {
      void handleRequest(
        request,
        response,
      );
    },
  );

  server.headersTimeout =
    SERVER_HEADERS_TIMEOUT_MS;

  server.requestTimeout =
    SERVER_REQUEST_TIMEOUT_MS;

  server.keepAliveTimeout =
    SERVER_KEEP_ALIVE_TIMEOUT_MS;

  server.maxConnections =
    SERVER_MAX_CONNECTIONS;

  return server;
}
