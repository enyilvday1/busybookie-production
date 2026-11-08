# BusyBookie Private/Staging Production-Engine Deployment

This document defines the initial private/staging deployment contract for the
BusyBookie production engine. It does not define the future public application
or public API.

## Locked topology

- One Linux host.
- Node.js 24.
- FFmpeg and FFprobe.
- One BusyBookie application root.
- One persistent block-backed BUSYBOOKIE_MEDIA_ROOT.
- ext4 or XFS for the authoritative media filesystem.
- Exactly one production writer.
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
block-backed volume.

The BusyBookie runtime user requires read/write access to the media root.

The media root must survive application redeployments.

Exactly one authoritative production writer is permitted.

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
- verify the persistent media volume is mounted;
- verify BUSYBOOKIE_MEDIA_ROOT is absolute and writable;
- verify the media filesystem is ext4 or XFS;
- verify exactly one production writer is active;
- verify NFS or SMB is not the authoritative media filesystem;
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
- BUSYBOOKIE_MEDIA_ROOT remains durable local filesystem authority.
- Exactly one production writer remains authoritative.
- NFS and SMB authority volumes remain prohibited.
- No premature PostgreSQL rewrite.
- No premature object-storage rewrite.
- No horizontal production-writer scaling.
- Generation completion does not itself grant publication authority.
