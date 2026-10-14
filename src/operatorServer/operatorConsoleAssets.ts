import {
  lstat,
  readdir,
  readFile,
} from "node:fs/promises";

// D3A operator-console static assets (Step 1005 sections 7-9). The built
// console is validated and loaded into memory once, before the server
// listens. Requests are answered by exact lookup only: request input is never
// turned into a filesystem path.

// Two levels below the repository root both under tsx (src/operatorServer)
// and under the root tsc layout (dist/operatorServer); independent of the
// working directory.
export const OPERATOR_CONSOLE_DIST_URL: URL =
  new URL(
    "../../apps/operator-console/dist/",
    import.meta.url,
  );

export const OPERATOR_CONSOLE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

export const MAX_OPERATOR_CONSOLE_FILE_BYTES =
  5 * 1024 * 1024;

export type OperatorConsoleBuildFailure =
  | "BUILD_DIRECTORY_MISSING"
  | "INDEX_HTML_MISSING"
  | "REFERENCED_ASSET_MISSING"
  | "UNSAFE_BUILD_ENTRY"
  | "MALFORMED_BUILD_STRUCTURE";

// Fixed, path-free message and no cause: filesystem error messages carry
// absolute paths and must not reach the launcher's output.
export class OperatorConsoleBuildError extends Error {
  readonly failure:
    OperatorConsoleBuildFailure;

  constructor(
    failure:
      OperatorConsoleBuildFailure,
  ) {
    super(
      `Operator console build is missing or invalid (${failure}). Build it with: npm --prefix apps/operator-console run build`,
    );

    this.name =
      "OperatorConsoleBuildError";

    this.failure =
      failure;
  }
}

export type OperatorConsoleResource =
  Readonly<{
    body:
      Buffer;

    headers:
      Readonly<Record<string, string>>;
  }>;

export type OperatorConsoleAssets =
  Readonly<{
    lookup:
      (pathname: string) => OperatorConsoleResource | undefined;
  }>;

const INDEX_FILE_NAME =
  "index.html";

const ASSETS_DIRECTORY_NAME =
  "assets";

const ASSET_NAME_PATTERN =
  /^[A-Za-z0-9_-]+\.(js|css)$/;

const ASSET_REFERENCE_PATTERN =
  /^\/assets\/([A-Za-z0-9_-]+\.(?:js|css))$/;

const CONTENT_TYPES:
  Readonly<Record<"html" | "js" | "css", string>> =
    Object.freeze({
      html:
        "text/html; charset=utf-8",
      js:
        "text/javascript; charset=utf-8",
      css:
        "text/css; charset=utf-8",
    });

const HTML_HEADERS =
  Object.freeze({
    "Content-Type":
      CONTENT_TYPES.html,
    "Content-Security-Policy":
      OPERATOR_CONSOLE_CSP,
    "Cache-Control":
      "no-store",
    "X-Content-Type-Options":
      "nosniff",
    "Referrer-Policy":
      "no-referrer",
    "Cross-Origin-Resource-Policy":
      "same-origin",
    "Cross-Origin-Opener-Policy":
      "same-origin",
  });

const ASSET_HEADERS =
  Object.freeze({
    "Cache-Control":
      "private, max-age=31536000, immutable",
    "X-Content-Type-Options":
      "nosniff",
    "Referrer-Policy":
      "no-referrer",
    "Cross-Origin-Resource-Policy":
      "same-origin",
  });

function fail(
  failure:
    OperatorConsoleBuildFailure,
): never {
  throw new OperatorConsoleBuildError(
    failure,
  );
}

function directoryUrl(
  url:
    URL,
): URL {
  return url.href.endsWith(
    "/",
  )
    ? url
    : new URL(
        `${url.href}/`,
      );
}

async function readBoundedFile(
  url:
    URL,
): Promise<Buffer> {
  let size:
    number;

  try {
    size =
      (await lstat(
        url,
      )).size;
  } catch {
    return fail(
      "MALFORMED_BUILD_STRUCTURE",
    );
  }

  if (
    size >
    MAX_OPERATOR_CONSOLE_FILE_BYTES
  ) {
    fail(
      "MALFORMED_BUILD_STRUCTURE",
    );
  }

  try {
    return await readFile(
      url,
    );
  } catch {
    return fail(
      "MALFORMED_BUILD_STRUCTURE",
    );
  }
}

function resource(
  body:
    Buffer,

  headers:
    Readonly<Record<string, string>>,
): OperatorConsoleResource {
  return Object.freeze({
    body,

    headers:
      Object.freeze({
        ...headers,
        "Content-Length":
          String(
            body.length,
          ),
      }),
  });
}

// Accepts only the current Vite output shape: external module script and
// stylesheet references to loaded /assets/ files, nothing inline.
function validateIndexHtml(
  html:
    string,

  assetNames:
    ReadonlySet<string>,
): void {
  const scriptTags =
    [
      ...html.matchAll(
        /<script\b([^>]*)>/gi,
      ),
    ].map(
      (match) =>
        match[1] ?? "",
    );

  if (
    scriptTags.some(
      (attributes) =>
        !/\bsrc\s*=/i.test(
          attributes,
        ),
    ) ||
    /<style\b/i.test(
      html,
    ) ||
    /<[^>]*\sstyle\s*=/i.test(
      html,
    )
  ) {
    fail(
      "UNSAFE_BUILD_ENTRY",
    );
  }

  // Every src/href must be a double-quoted value; anything else is refused
  // rather than interpreted.
  if (
    /\b(?:src|href)\s*=\s*(?!")/i.test(
      html,
    )
  ) {
    fail(
      "UNSAFE_BUILD_ENTRY",
    );
  }

  for (
    const match
    of html.matchAll(
      /\b(?:src|href)\s*=\s*"([^"]*)"/gi,
    )
  ) {
    const reference =
      ASSET_REFERENCE_PATTERN.exec(
        match[1] ?? "",
      );

    if (
      reference ===
      null
    ) {
      fail(
        "UNSAFE_BUILD_ENTRY",
      );
    }

    if (
      !assetNames.has(
        reference[1] ?? "",
      )
    ) {
      fail(
        "REFERENCED_ASSET_MISSING",
      );
    }
  }

  const hasModuleScript =
    scriptTags.some(
      (attributes) =>
        /\btype\s*=\s*"module"/i.test(
          attributes,
        ) &&
        /\bsrc\s*=\s*"\/assets\/[A-Za-z0-9_-]+\.js"/i.test(
          attributes,
        ),
    );

  if (
    !hasModuleScript
  ) {
    fail(
      "MALFORMED_BUILD_STRUCTURE",
    );
  }
}

export async function loadOperatorConsoleAssets(
  distDirectory:
    URL =
      OPERATOR_CONSOLE_DIST_URL,
): Promise<OperatorConsoleAssets> {
  const root =
    directoryUrl(
      distDirectory,
    );

  try {
    if (
      !(await lstat(
        root,
      )).isDirectory()
    ) {
      fail(
        "BUILD_DIRECTORY_MISSING",
      );
    }
  } catch (
    error
  ) {
    if (
      error instanceof
      OperatorConsoleBuildError
    ) {
      throw error;
    }

    fail(
      "BUILD_DIRECTORY_MISSING",
    );
  }

  const rootEntries =
    await readEntries(
      root,
      "BUILD_DIRECTORY_MISSING",
    );

  const indexEntry =
    rootEntries.find(
      (entry) =>
        entry.name ===
        INDEX_FILE_NAME,
    );

  const assetsEntry =
    rootEntries.find(
      (entry) =>
        entry.name ===
        ASSETS_DIRECTORY_NAME,
    );

  if (
    rootEntries.some(
      (entry) =>
        entry.name !==
          INDEX_FILE_NAME &&
        entry.name !==
          ASSETS_DIRECTORY_NAME,
    ) ||
    (indexEntry !==
      undefined &&
      !indexEntry.isFile())
  ) {
    fail(
      "UNSAFE_BUILD_ENTRY",
    );
  }

  if (
    indexEntry ===
    undefined
  ) {
    fail(
      "INDEX_HTML_MISSING",
    );
  }

  if (
    assetsEntry ===
      undefined ||
    !assetsEntry.isDirectory()
  ) {
    fail(
      "MALFORMED_BUILD_STRUCTURE",
    );
  }

  const assetsDirectory =
    new URL(
      `${ASSETS_DIRECTORY_NAME}/`,
      root,
    );

  const assetEntries =
    await readEntries(
      assetsDirectory,
      "MALFORMED_BUILD_STRUCTURE",
    );

  if (
    assetEntries.some(
      (entry) =>
        !entry.isFile() ||
        !ASSET_NAME_PATTERN.test(
          entry.name,
        ),
    )
  ) {
    fail(
      "UNSAFE_BUILD_ENTRY",
    );
  }

  const resources =
    new Map<string, OperatorConsoleResource>();

  for (
    const entry
    of assetEntries
  ) {
    const body =
      await readBoundedFile(
        new URL(
          entry.name,
          assetsDirectory,
        ),
      );

    const contentType =
      entry.name.endsWith(
        ".js",
      )
        ? CONTENT_TYPES.js
        : CONTENT_TYPES.css;

    resources.set(
      `/${ASSETS_DIRECTORY_NAME}/${entry.name}`,
      resource(
        body,
        {
          "Content-Type":
            contentType,
          ...ASSET_HEADERS,
        },
      ),
    );
  }

  const indexBody =
    await readBoundedFile(
      new URL(
        INDEX_FILE_NAME,
        root,
      ),
    );

  validateIndexHtml(
    indexBody.toString(
      "utf8",
    ),
    new Set(
      assetEntries.map(
        (entry) =>
          entry.name,
      ),
    ),
  );

  if (
    !assetEntries.some(
      (entry) =>
        entry.name.endsWith(
          ".js",
        ),
    )
  ) {
    fail(
      "MALFORMED_BUILD_STRUCTURE",
    );
  }

  resources.set(
    "/",
    resource(
      indexBody,
      HTML_HEADERS,
    ),
  );

  return Object.freeze({
    lookup:
      (pathname: string) =>
        resources.get(
          pathname,
        ),
  });
}

async function readEntries(
  directory:
    URL,

  failure:
    OperatorConsoleBuildFailure,
) {
  try {
    return await readdir(
      directory,
      {
        withFileTypes:
          true,
      },
    );
  } catch {
    return fail(
      failure,
    );
  }
}
