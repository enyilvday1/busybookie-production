# BusyBookie Private/Staging Production-Engine Deployment

This document defines the initial private/staging deployment contract for the
BusyBookie production engine. It does not define the future public application
or public API.

## Locked topology

- One Linux host.
- Node.js 24.
- FFmpeg and FFprobe.
- One BusyBookie application root.
- One persistent block-backed data volume mounted at /var/lib/busybookie.
- One persistent block-backed BUSYBOOKIE_MEDIA_ROOT at
  /var/lib/busybookie/media.
- ext4 or XFS for the persistent data volume, including the authoritative
  media filesystem.
- Exactly one production writer of the media root.
- SSH for administrative access.
- No NFS or SMB authority filesystem.
- No horizontal production writers.
- No PostgreSQL rewrite required for private v1.
- No object-storage rewrite required for private v1.

## Application root

The runtime application root must contain package.json, package-lock.json,
busybookie-release-identity.json, root node_modules, dist,
apps/operator-console/dist, config, and episodes.

BusyBookie resolves runtime inputs relative to process.cwd(), so production
commands must run from the application root.

Read-only hardening of the application root is deferred until Linux runtime
validation proves it safe.

## Build contract

Use an approved Git revision.

Build sequence:

    npm ci
    npm --prefix apps/operator-console ci
    npm run build

For a clean runtime production-dependency install:

    npm ci --omit=dev

tsx remains development-only and is not required on the production host.

## Portable release identity

Portable production releases must contain
busybookie-release-identity.json at the application root.

Generate the identity only from the clean approved Git checkout after
npm run build has completed and after the portable release root contains
the exact compiled dist, package.json, and package-lock.json that will be
archived.

From the approved source checkout:

    npm run release:identity -- --release-root /absolute/path/to/release-root

The release-identity command is a packaging-time authority. It must not be
run on the deployed production host, and tsx must not be installed on the
production host merely to support this command.

The command fails closed when the reviewed source checkout is dirty, when
untracked release-authority source files exist, when the portable release
contains Git metadata, when executable inventory differs, when release
runtime bytes differ from the reviewed build, or when an identity manifest
already exists.

The identity binds the approved 40-character Git revision plus every
dist/**/*.js runtime file, package.json, and package-lock.json. TypeScript
declarations and source maps are not runtime executable inputs. config,
episodes, references, durable execution evidence, media, and FFprobe remain
governed by their existing independent runtime/input-binding contracts.

Generate the identity before locking the release archive and its SHA-256.
Do not copy .git into a portable release and do not fabricate Git metadata
on the deployment host.

## Environment contract

The tracked root .env.example is the authoritative key checklist:

- BUSYBOOKIE_MEDIA_ROOT
- BUSYBOOKIE_FFMPEG_PATH
- BUSYBOOKIE_FFPROBE_PATH
- RUNWAYML_API_SECRET
- GEMINI_API_KEY

Real deployment secrets and environment files must stay outside the repository.

BUSYBOOKIE_MEDIA_ROOT is required.

FFmpeg and FFprobe path overrides are optional when the correct executables are
available on PATH.

Provider credentials are required only for operations that use that provider.

## Media authority

BUSYBOOKIE_MEDIA_ROOT must be an absolute path on the dedicated persistent
block-backed volume. The canonical value on the private/staging host is:

    BUSYBOOKIE_MEDIA_ROOT=/var/lib/busybookie/media

/var/lib/busybookie/media is the engine/media-owned directory.

The BusyBookie runtime user requires read/write access to the media root.

The media root must survive application redeployments.

Exactly one authoritative production writer of the media root is permitted.

## Persistent data volume

The private/staging host's dedicated persistent block-backed data volume is
mounted at:

    /var/lib/busybookie

It holds durable runtime data only. It is not application code and not
release storage.

The mount must:

- be backed by the dedicated persistent block-backed volume;
- survive service restart, host reboot, application redeploy and
  binary/release replacement;
- use an ext4 or XFS filesystem;
- not be NFS, SMB, FAT, exFAT, object-store or other FUSE-backed storage;
- not be an ephemeral container or image filesystem.

The volume is persistent independently of the Git checkout, the release
directory, the application binary, the current process and any redeploy.
Replacing a release must never replace or clear it.

Canonical layout:

    /var/lib/busybookie/            persistent-volume mount
    |-- media/                      BUSYBOOKIE_MEDIA_ROOT (engine/media)
    `-- commercial-worker/          reserved commercial-worker state root
        `-- acceptance-journal/     application-managed
            |-- v1/
            `-- quarantine/

media/ and commercial-worker/ are sibling service-data roots that share the
same approved persistent filesystem. commercial-worker/ is not inside
media/. acceptance-journal/ and its children are created and managed by the
commercial worker beneath its own root.

The Git checkout, release directories and executable application files must
not live under /var/lib/busybookie.

The deployment operator provisions /var/lib/busybookie and each
service-specific root directory before the corresponding service starts. The
application never creates the persistent-volume mount itself.

## Reserved commercial-worker state root

    /var/lib/busybookie/commercial-worker

is reserved as the commercial worker's durable state root. Its future
application configuration binding is:

    COMMERCIAL_WORKER_STATE_ROOT=/var/lib/busybookie/commercial-worker

This is a deployment-path reservation only. It does not mean that:

- COMMERCIAL_WORKER_STATE_ROOT is implemented or read by any worker code;
- a commercial-worker process exists or is deployed;
- state-root application binding is complete;
- the fake-provider gate is complete;
- fake-provider or provider execution is enabled.

The application contract that consumes this path is defined separately in
docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md.

Rules for this root:

- It must already exist before the commercial worker starts. The worker may
  create only its managed descendants beneath it.
- It is separate from BUSYBOOKIE_MEDIA_ROOT. The worker must not write
  acceptance-journal files into the media tree, use the media root as its
  state root, or derive its state root from the media path.
- /var/lib/busybookie/commercial-worker and its acceptance-journal/v1 and
  acceptance-journal/quarantine tree must stay on the same filesystem as
  /var/lib/busybookie. No nested mount may split the temporary, final or
  quarantine journal paths, because the journal publishes and quarantines
  through hard links.
- Exactly one commercial-worker process may own this root. No second
  commercial-worker process may share it. This rule is scoped to the worker
  state root: other BusyBookie components keep using their own sibling
  directories under their existing rules.
- It belongs to one worker principal and one environment. Development,
  staging and production never share a worker state root. This Linux path is
  the private/staging host layout; development and test machines use their
  own explicitly configured roots.
- It is owned by the commercial-worker service user, with no group or other
  access. The exact service account is defined by the future worker service
  deployment slice. The worker's managed journal directories and files keep
  their owner-only policy.
- Its absolute path is documented here, but the application never logs it.

Warning: never point the same logical commercial worker at a new, empty
COMMERCIAL_WORKER_STATE_ROOT while retained worker state exists in the old
root. No migration mechanism exists yet. Never delete, clear or relocate
/var/lib/busybookie/commercial-worker as part of a normal deployment.

## Operator server

The operator server is an internal read-only control plane.

It must remain bound only to:

    127.0.0.1:4381

It must not be exposed directly to the public internet and must not be treated
as the future public BusyBookie SaaS API.

The operator process should receive only the environment needed for status
inspection, normally BUSYBOOKIE_MEDIA_ROOT and optionally
BUSYBOOKIE_FFPROBE_PATH.

Provider API credentials must not be given to the operator process merely for
convenience.

## Operator token contract

The operator server generates a fresh bearer token for every launch.

The token:

- is generated inside the operator process;
- is printed once to the attached launching terminal;
- is valid only for that launch;
- must not be logged or persisted;
- is not placed in a URL;
- remains only in browser-tab memory.

There is no token-file, token-fd, or external token-input interface.

A conventional detached systemd operator service is therefore not approved for
private v1.

Do not route token-bearing startup stdout into the systemd journal, a log file,
tee, or nohup.

## Private operator launch

Use an SSH-attached operator session.

From the administrator workstation:

    ssh -L 4381:127.0.0.1:4381 <runtime-user>@<private-host>

In the attached remote terminal:

    cd <application-root>
    npm start

Keep the operator process attached to that terminal.

Open locally:

    http://127.0.0.1:4381/

Paste the one-time token shown in the attached terminal into the operator
console unlock page.

Stop the operator server with Ctrl+C when the operator session is complete.

Do not bind the operator server to 0.0.0.0.

Do not expose port 4381 publicly.

## Canonical compiled production commands

The private/staging production command surface is:

    npm run production:execution:reconcile
    npm run production:execution:status
    npm run production:episode:automate
    npm run production:episode:rough-cut
    npm run production:dialogue:authorize-visual
    npm run production:dialogue:place

These commands execute compiled JavaScript from dist and do not require tsx on
the production host.

Load only the credentials required by the operation being executed.

Recovery of an existing provider execution does not itself grant authority for
a new paid submission.

Production activation and paid-generation gates remain authoritative.

## Network boundary

The operator server has no public inbound requirement.

Administrative browser access must use SSH local port forwarding to the
loopback-only operator server.

Provider operations may require outbound HTTPS access from the engine host.

The future public BusyBookie frontend and application API are separate
boundaries. Public browser clients must not connect directly to the internal
operator API.

## Private/staging smoke gate

Before any paid generation is attempted on the deployed host:

- verify busybookie-release-identity.json records the approved Git revision;
- verify the portable application root contains no .git metadata;
- verify Node.js 24;
- verify FFmpeg and FFprobe are executable;
- verify /var/lib/busybookie exists and is a mount point backed by the
  persistent block volume, for example with
  `findmnt -no SOURCE,FSTYPE /var/lib/busybookie`;
- verify that filesystem type is ext4 or XFS, and that it is not NFS, SMB,
  FAT, exFAT, FUSE or other network or object-store storage;
- verify /var/lib/busybookie/media exists and BUSYBOOKIE_MEDIA_ROOT is
  exactly /var/lib/busybookie/media, absolute and writable;
- verify /var/lib/busybookie/commercial-worker exists before any
  commercial-worker startup, and that
  `findmnt -no TARGET --target /var/lib/busybookie/commercial-worker`
  reports /var/lib/busybookie (no nested mount);
- verify neither data root is inside the Git checkout or release tree;
- verify exactly one production writer of the media root is active;
- install root production dependencies deterministically;
- run the production dependency audit;
- verify all compiled production entrypoints exist;
- verify busybookie-release-identity.json is present and readable;
- verify portable runtime identity succeeds without requiring a Git worktree;
- verify apps/operator-console/dist exists;
- verify config is present;
- verify required episode manifests are present;
- verify the operator binds only to 127.0.0.1;
- verify the SSH tunnel reaches the operator console;
- verify the one-time token unlocks the console;
- verify an unauthenticated protected API request is rejected;
- verify clean SIGINT and SIGTERM shutdown;
- exercise status and recovery before generation.

Do not use a paid generation submission as the first deployment smoke test.

## Deferred systemd service

No detached operator systemd unit is shipped for private v1.

This is intentional.

The current operator token is generated inside the process, printed once to
the attached terminal, and must not be logged or persisted.

There is currently no reviewed token-file, token-fd, or other secure detached
bootstrap interface.

Do not solve this by sending the token to the systemd journal.

If unattended operator availability later becomes necessary, implement and
review a separate secure bootstrap mechanism before adding a detached service.

The compiled production CLI does not depend on that future change.

## Locked private-v1 boundaries

- The operator API remains loopback-only.
- The operator API is not the future public SaaS API.
- BUSYBOOKIE_MEDIA_ROOT remains durable local filesystem authority, at
  /var/lib/busybookie/media on the persistent volume mounted at
  /var/lib/busybookie.
- Exactly one production writer of the media root remains authoritative.
- /var/lib/busybookie/commercial-worker is reserved as the commercial-worker
  state root, owned by exactly one commercial-worker process.
- NFS and SMB authority volumes remain prohibited.
- No premature PostgreSQL rewrite.
- No premature object-storage rewrite.
- No horizontal production-writer scaling.
- Generation completion does not itself grant publication authority.
