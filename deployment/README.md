# BusyBookie Private/Staging Production-Engine Deployment

This document defines the initial private/staging deployment contract for the
BusyBookie production engine. It does not define the future public application
or public API.

## Locked topology

- One Linux host.
- Node.js 24.
- FFmpeg and FFprobe.
- One BusyBookie application root (see Application root for installed
  revisions).
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
busybookie-release-identity.json, dist, apps/operator-console/dist, config,
and episodes, and its production dependencies must resolve from it.

For a release installed by production:release:install, the application root
is <releases-root>/<revision>/app. Its production dependencies are the sibling
<releases-root>/<revision>/node_modules, not a node_modules directory inside
app/; Node.js resolves them through its normal parent-directory module lookup.
Each immutable installed revision has its own application root.
Transactional installation does not select or activate a revision. See
Transactional portable release installation.

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

In a source checkout or build environment, a production-only dependency
install is:

    npm ci --omit=dev

This is not the portable-release installation procedure. A deployed portable
release receives its production dependencies only through
production:release:install, which runs npm ci itself inside the transactional
installer.

tsx remains development-only and is not required on the production host.

## Portable release identity

Portable production releases must contain
busybookie-release-identity.json at the application root.

Generate the identity only from the clean approved Git checkout after
npm run build has completed and after the portable release root contains
the exact compiled dist, apps/operator-console/dist, package.json, and
package-lock.json that will be archived.

For identity-only inspection from the approved source checkout:

    npm run release:identity -- --release-root /absolute/path/to/release-root

The release-identity command is the lower-level identity-only authority.
Normal portable archive creation must use the deterministic release-package
command described below; do not create the identity first when using that
command because release:package creates and binds the identity itself.

Both packaging-time commands must run from the approved build environment,
not on the deployed production host. tsx must not be installed on the
production host merely to support either command.

The command fails closed when the reviewed source checkout is dirty, when
untracked release-authority source files exist, when the portable release
contains Git metadata, when executable or operator-console inventory differs,
when release runtime or operator-console bytes differ from the reviewed
build, when the operator-console build is missing or malformed, or when an
identity manifest already exists.

Portable Release Identity schema 2.0 binds the approved 40-character Git
revision plus, each by byte length and SHA-256:

- every root dist/**/*.js runtime file;
- apps/operator-console/dist/index.html;
- every apps/operator-console/dist/assets/*.js and *.css file;
- package.json;
- package-lock.json.

A schema 1.0 manifest, which does not bind the operator-console build, is
not accepted. TypeScript declarations and source maps are not runtime
executable inputs. config, episodes, references, durable execution evidence,
media, and FFprobe remain governed by their existing independent
runtime/input-binding contracts.

The compiled production operator entrypoint (npm start, which runs
dist/operatorServer/operatorServerProcess.js) first requires the working
directory to be exactly the application root that contains the executed
entrypoint, then verifies this identity for that root, before it loads
operator-console assets, listens, or prints the one-time token. A working
directory other than the application root, or a missing, schema 1.0 or
mismatched identity, stops startup with one path-free error line and a
non-zero exit, and nothing listens. The source development command
npm run operator:serve does not require a release identity.

Do not copy .git into a portable release and do not fabricate Git metadata
on the deployment host.

## Deterministic portable release package

Normal portable release creation is the high-level operation:

    npm run release:create -- \
      --output-directory /absolute/path/to/output-directory

release:create:

- requires the Git repository top level at a canonical reviewed HEAD;
- requires clean tracked/staged source and rejects guarded untracked
  release/build-authority source inputs;
- runs the repository-authoritative npm run build from that reviewed checkout;
- revalidates the same reviewed Git authority after the controlled build;
- snapshots the fresh dist and apps/operator-console/dist build outputs with
  mutation-sensitive checks;
- assembles tracked release inputs from reviewed Git blob bytes rather than
  working-tree bytes;
- invokes the deterministic lower-level release:package primitive; and
- removes its temporary assembly root on success or failure.

The output directory for release:create must already exist, must be absolute,
and must be outside the reviewed source checkout.

The lower-level packaging operation remains available for an already assembled
portable release root:

    npm run release:package -- \
      --release-root /absolute/path/to/release-root \
      --output-directory /absolute/path/to/output-directory

For release:package, the source root defaults to the current working directory.
An explicit --source-root may be supplied when required, but it must resolve to
the Git repository top level accepted by the release-identity authority.

release:package:

- requires an already assembled portable release root with no existing
  busybookie-release-identity.json;
- creates and verifies Portable Release Identity schema 2.0 against the
  clean approved Git revision;
- inventories every regular file in the complete portable release tree and
  rejects Git metadata, node_modules, symbolic links, multiply-linked files
  and other non-regular entries;
- writes a whole-tree SHA-256 manifest whose member paths are the exact
  archive file inventory;
- creates the gzip-compressed tar archive with GNU tar and gzip using fixed
  ownership, timestamp and gzip-name metadata;
- emits regular-file archive members only; directory entries are not
  separate archive members;
- verifies exact archive-member inventory and independently streams every
  archived member to prove its SHA-256 bytes match the whole-tree manifest;
- re-inventories and re-hashes the portable release tree immediately before
  publication so an in-flight tree mutation fails closed;
- refuses an output directory inside the release root and refuses an output
  directory inside the reviewed source checkout except beneath source .git;
- refuses to overwrite final or temporary packaging artifacts; and
- removes partial published artifacts, temporary artifacts and the identity
  it created when packaging fails.

The output names are bound to the approved 40-character Git revision:

    busybookie-release-<revision>-tree.sha256
    busybookie-release-<revision>.tar.gz

The successful release:package process exit is the publication boundary.
The manifest and archive are published by separate same-filesystem renames;
consumers must not treat either file appearing alone while the command is
still running as a completed package.

GNU tar with the required deterministic options and gzip no-name mode are
mandatory packaging-toolchain dependencies on the build/package host. They are
not runtime dependencies of the deployed service, but the installation host
also needs GNU tar and gzip because production:release:install extracts the
archive with GNU tar.

## Transactional portable release installation

production:release:install installs one reviewed portable release, as
produced by release:create, into an immutable revision directory on the
deployed Linux host. The installer:

- snapshots the release archive and whole-tree manifest and verifies them
  against the expected SHA-256 values;
- extracts the archive into a private staging directory, verifies the
  extracted tree against the manifest, and verifies that the release identity
  records the expected reviewed revision;
- prepares production dependencies with npm ci from the verified
  package.json and package-lock.json and records dependency-install
  provenance;
- makes the complete private release durable, then publishes it with one
  atomic rename;
- writes a durable install receipt, which is the commit record of the
  installation;
- replays an already committed installation exactly; and
- fails closed on inconsistent committed state.

Installation does not activate a release. It creates no current or previous
pointer and starts no process.

### Installation host requirements

- Linux. The per-revision installation lock and the production npm runner
  are Linux-only, and the installer refuses to run elsewhere.
- Node.js 24 with its bundled npm on PATH, and access to the npm registry or
  mirror/cache configured for the installing user, because dependency
  preparation runs npm ci.
- GNU tar and gzip, used to extract the archive.
- flock (util-linux), used for the per-revision installation lock.

tsx is not required.

### Directory layout

    <releases-root>/
    |-- <revision>/                       immutable installed release
    |   |-- app/                          application root (release archive)
    |   `-- node_modules/                 production dependencies
    |       `-- .busybookie-install-provenance.json
    |-- .receipts/<revision>.json         install receipt (commit record)
    |-- .install-locks/<revision>.lock    per-revision installation lock
    `-- .quarantine/<revision>.<id>/      uncommitted residue, evidence only

    <staging-root>/
    `-- .<revision>.installing-<random>/  private installation work

node_modules is a sibling of app/, not inside it. Production commands run from
app/ (see Application root).

The installer creates the releases root and the staging root when they are
missing; a releases root it creates is fsynced into its parent. The staging
root must be on the same filesystem as the releases root, because publication
is an atomic rename, and the installer refuses otherwise. Keep both roots
outside /var/lib/busybookie (see Persistent data volume).

A second installation of the same revision waits up to 30 seconds for the
per-revision lock and then fails.

### Install command

On the production host:

    npm run production:release:install -- \
      --archive /path/to/busybookie-release-<revision>.tar.gz \
      --tree-manifest /path/to/busybookie-release-<revision>-tree.sha256 \
      --expected-archive-sha256 <64-lowercase-hex> \
      --expected-tree-manifest-sha256 <64-lowercase-hex> \
      --reviewed-revision <40-lowercase-hex> \
      --releases-root /srv/busybookie/releases \
      --staging-root /srv/busybookie/staging

The angle-bracket values are placeholders, not authority values.

npm run production:release:install runs the compiled
dist/deployment/installPortableReleaseProcess.js. Where no package script is
available, run that file directly with node and the same flags (see First
installation). From an approved source checkout,
npm run release:install -- <flags> runs the same command through tsx, for
development use only.

All seven flags are required, each exactly once:

- --archive
- --tree-manifest
- --expected-archive-sha256
- --expected-tree-manifest-sha256
- --reviewed-revision
- --releases-root
- --staging-root

There are no defaults and no other flags. --reviewed-revision must be exactly
40 lowercase hexadecimal characters, and both expected SHA-256 values must be
exactly 64 lowercase hexadecimal characters. Path flags resolve against the
current working directory, so prefer absolute paths. Take the expected values
from the release:create result of the reviewed release, never from the files
being installed.

On success the command prints the installation result as JSON on stdout and
exits 0. The result contains reviewedRevision, releaseRoot (the installed
app/ directory), receiptPath, archiveSha256, treeManifestSha256,
identityManifestSha256, installedFileCount, dependencyManifestSha256,
dependencyFileCount and dependencyTotalBytes. A fresh installation and an
exact replay print the same result. On failure the command prints one line
beginning "Portable release installation failed:" on stderr, prints nothing
on stdout, and exits 1.

### First installation (bootstrap)

The production host needs neither tsx nor a source checkout. Every release
archive already contains the compiled dist/**/*.js, including
dist/deployment/installPortableReleaseProcess.js, and package.json with
"type": "module", and the installer needs no node_modules to run. Archives
created from revisions that predate production:release:install do not contain
the installer.

Follow this order:

1. Verify the archive before running anything from it:

       sha256sum /path/to/busybookie-release-<revision>.tar.gz

   The digest must equal the reviewed expected archive SHA-256. Stop on any
   mismatch.

2. Extract a bootstrap copy into a new, empty directory outside the releases
   and staging roots:

       mkdir /path/to/bootstrap
       tar --extract --gzip \
         --file /path/to/busybookie-release-<revision>.tar.gz \
         --directory /path/to/bootstrap

3. Run the compiled installer from that bootstrap copy, with the same seven
   flags as above:

       node /path/to/bootstrap/dist/deployment/installPortableReleaseProcess.js \
         --archive /path/to/busybookie-release-<revision>.tar.gz \
         ...

4. The installer then performs the authoritative installation: it verifies
   the archive again and verifies the tree manifest, extracts its own private
   copy, and publishes the release under the releases root.

The bootstrap copy is not the installed release and nothing reads it after
the installer exits; remove it afterwards. Later installations may instead run
the compiled installer from a previously installed, trusted release:

    node <releases-root>/<installed-revision>/app/dist/deployment/installPortableReleaseProcess.js ...

### Transaction model

The install receipt is the commit record. Under the per-revision lock the
installer classifies the existing state:

- Release and receipt: a committed installation. The command performs an
  exact replay (see Exact replay).
- Release only: uncommitted residue of an interrupted installation. It is
  moved atomically into .quarantine, and a fresh installation follows.
- Receipt only: inconsistent committed state. Automatic recovery is refused
  with "Committed install receipt exists but its immutable release directory
  is missing; automatic recovery is unsafe and operator intervention is
  required." See Receipt-only recovery.
- Neither: a fresh installation.

### Dependency preparation

Dependency preparation copies the verified package.json and
package-lock.json into a private work directory and runs:

    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --no-bin-links

Both files must still be byte-identical to the verified copies afterwards.
The preparer then runs npm --version with the same npm executable in the same
work directory and writes node_modules/.busybookie-install-provenance.json,
which records nodeVersion, npmVersion, platform and arch. That file is written
before the dependency manifest is created, so it is bound into
dependencyManifestSha256 like every other dependency file. The installer
re-creates the dependency manifest itself before publication and requires it
to match.

### Durability and publication

- Every file of the verified app/ tree and of node_modules, then their
  directories and the private release root, are fsynced before publication.
- The release is published with one atomic rename, after which both the
  staging root and the releases root are fsynced.
- The receipt is written to a temporary file and fsynced, then renamed into
  .receipts. That rename is the commit point, and .receipts is fsynced after
  it.
- Before publication, failures clean up private staging state. If a failure
  occurs after publication but before the receipt commit point, the installer
  removes the published release when rollback is safe and fsyncs the releases
  root. Anything left behind is handled as release-only residue by the next
  installation.
- Once the receipt exists, or when its presence cannot be determined, a
  failure never removes the release. After the commit point the release is
  never destructively rolled back; the next installation replays it.

### Exact replay

Rerunning the command for a committed revision verifies the archive and
manifest inputs, the installed app/ tree, the release identity, the installed
node_modules manifest and the receipt, then prints the stored result. It does
not extract the archive, rerun npm or recapture provenance. Any change to the
set of regular files in node_modules or to their bytes after the commit,
including the provenance file, makes the replay fail closed. Permission,
ownership and timestamp changes are not detected by the dependency manifest.

### Receipt-only recovery

Recovery from a receipt whose immutable release directory is missing is
manual and fail-closed. No recovery command exists.

- Stop automated and repeated installation attempts for that revision.
- Preserve the receipt and the rest of the releases root.
- Confirm that the receipt names the expected revision and the reviewed
  archive, manifest and dependency authorities.
- Determine why the immutable release directory disappeared.
- Check whether a quarantined or externally moved copy of it exists.
- Do not regenerate the release by rerunning npm, and do not delete the
  receipt merely to unblock installation.
- Escalate to an operator-reviewed manual recovery.

### Quarantine

Release-only residue is moved to <releases-root>/.quarantine/<revision>.<id>/
with one same-filesystem rename that never replaces existing evidence.
Quarantined bytes are evidence only: they are never trusted as installation
authority, reused, copied into a new release or used to synthesize a receipt.
The fresh installation starts again from the reviewed archive.

Quarantine has no automatic retention or cleanup. Operators must manage its
disk usage deliberately.

### Stale private staging state

A crash can leave .<revision>.installing-<random> directories in the staging
root. They are never installation authority and do not block later
installations, which always use new, uniquely named directories. Nothing
sweeps them automatically; remove them during housekeeping while no
installation is running.

A crash or a cleanup failure can likewise leave private receipt-temporary
state under .receipts, such as .receipts/.receipt-<revision>-<random>/. It is
not the committed receipt and not installation authority, and exact replay
ignores it. Nothing removes it automatically; it may need the same
housekeeping.

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

is reserved as the commercial worker's durable state root. Its application
configuration binding is:

    COMMERCIAL_WORKER_ENV=production
    COMMERCIAL_WORKER_STATE_ROOT=/var/lib/busybookie/commercial-worker

The worker configuration and state-root binding are implemented
(apps/commercial-worker/src/workerConfig.ts and workerStateRoot.ts). In
production mode the worker accepts exactly this root and no other. The
binding fails closed, before any control-plane request, unless the host is
Linux and the root:

- already exists (the worker never creates it);
- is a directory and not a symbolic link;
- is owned by the worker's effective UID;
- grants no group or other permissions;
- passes acceptance-journal preparation, including its managed
  acceptance-journal descendants and required directory fsync.

The operator must therefore pre-provision this root with that ownership and
mode.

This does not mean that:

- a commercial-worker process exists or is deployed: the worker remains
  library/composition code with no production process entry point and is
  not started by default;
- this runbook deploys, configures or starts a commercial-worker service;
- commercial-worker fake-provider or live-provider execution is enabled on this host;
- commercial SaaS operation is approved.

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
    npm run production:episode:adopt-visual-evidence
    npm run production:dialogue:authorize-visual
    npm run production:dialogue:place
    npm run production:release:install

These commands execute compiled JavaScript from dist and do not require tsx on
the production host.

production:release:install installs a reviewed portable release; see
Transactional portable release installation for its flags, bootstrap and
recovery rules.

production:episode:adopt-visual-evidence records a durable HUMAN_OPERATOR
review of one VERIFIED COMPLETED visual output:

    npm run production:episode:adopt-visual-evidence -- \
      --episode <episodeId> --shot <shotId> \
      --expected-manifest-sha256 <digest> \
      --expected-observation-sha256 <digest> \
      --confirm-adoption

It re-verifies the current completed evidence locally, then creates one
immutable receipt under the shot's generated-video directory in
BUSYBOOKIE_MEDIA_ROOT. An existing receipt is never replaced. A later preflight
binds the exact receipt bytes.

The receipt is evidence only. The adoption command itself makes no provider
call and does not execute or bypass generation or reconciliation controls.
Reviewing an earlier completed shot may expose the next normal frontier in a
fresh preflight; any later provider action still requires a fresh bound plan,
the applicable explicit confirmation, episode guard ownership, and all normal
admission checks.

This command reads only BUSYBOOKIE_MEDIA_ROOT and the optional
BUSYBOOKIE_FFPROBE_PATH from the process environment. It does not load a .env
file and needs no provider credential, so export those two values in the
attached operator shell before running it.

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
- install the release with production:release:install, which prepares its
  production dependencies transactionally, and keep the printed result;
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
