# Digest preview (#6)

The capture is a copy of a real `GET /digest/2026-10-28`, not a browser save or an
`app.request()` export. It contains the sample digest, inline CSS and lane banner.
Never put the HTML, `.env` or marker in Git, issues, logs or chat attachments (ADR 0003).

## Capture locally

Install with pnpm **12.23.0** and `pnpm install --frozen-lockfile`; use Node 22+.
Supply `LANE_MARKER` privately in the environment for marked mode. Do not put its
value on a command line. The capture command deliberately does **not** load `.env`.
Choose an existing private directory outside the checkout and a new filename:

```sh
pnpm capture:preview --mode marked --output /absolute/private/directory/index.html
```

The command starts the real `src/server.ts` in a disposable working directory,
with an OS-assigned free port (`PORT=0`) bound only to `127.0.0.1`. The server sends
its port over IPC. The command issues one direct loopback HTTP GET, checks for a
complete self-contained page and the expected banner, and saves the entire body
byte-for-byte with owner-only file permissions. It never prints HTML or the marker.
It stops the server and removes the disposable configuration/heartbeat directory
on success, failure or SIGINT/SIGTERM; a stubborn server receives SIGKILL after two
seconds. Startup and capture have a 30-second combined deadline.

An absolute output path is required. The parent must already exist. Outputs inside
the checkout, symlinked parents pointing inside it, existing files and final-component
symlinks are refused. Nothing is written to `runs/` or the checkout's heartbeat directory.
Inherited `PORT`, `NODE_OPTIONS` and unrelated secrets are not passed to the server.

For a **local test** of the marker-free capture, use a different new file:

```sh
pnpm capture:preview --mode clean --output /absolute/private/directory/clean.html
```

Clean mode explicitly empties `LANE_MARKER` in the server environment, even when
the calling shell has a marker. Its banner must read `no marker set`. Local capture
does not authorize publishing or replacing any public copy. Remove private local
captures when no longer needed.

## Manual public deployment

`.github/workflows/preview.yml` only runs on `workflow_dispatch` from the default
branch. Pushing commits cannot publish. It uses one standard `ubuntu-latest` runner,
Node 24, pinned pnpm 12.23.0, frozen installation, tests and typecheck. Neither setup
action caches package data. Checkout does not persist its credentials.

The approved replaceable host is GitHub Pages. For this repository the expected
public URL is `https://sakadin.github.io/mega-s01e04-rig/` (host selected and enabled
by the human/main session). Publishing makes the sample digest and banner public
to anyone with the link. This guide and workflow do not prove a deployment happened.

For the human-approved marked upload, main may manually dispatch **Publish digest
preview** with `mode=marked` (the default). Only that capture step receives the masked
repository Actions secret `LANE_MARKER`; a missing/blank secret fails closed. The
workflow writes only `index.html` under `$RUNNER_TEMP/rig-preview`, outside checkout,
uploads that directory, and deploys it to the Pages root.

After successful deployment, the workflow deletes **only the artifact ID returned
by that run's upload step**, not artifacts selected by a broad name search. The Pages
site remains served independently. It also removes the runner-local capture/archive.
Artifact retention is one day as a fallback if deployment fails before the deletion
step; a failed deployment or failed deletion needs investigation and exact-ID cleanup.
Do not treat a failed workflow as a successful preview handoff.

Main must then fetch the public HTTPS URL anonymously, compare its body with a local
capture, verify the sample data/banner/self-contained page, and send the reviewer the
link plus the plan's issues. Keep the submission/reply private. **Issue #6 stays open
until submission, public-copy verification and confirmation that the reviewer has
seen the page are complete.** The course rejected closure based only on submission;
the original preview worker owns #6's final state and closing comment.

### Marker-free replacement: separate approval required

Leave the marked page in place until review responds. Obtain a new explicit human
approval for marker-free replacement. Only then dispatch the same workflow with
`mode=clean` and `clean_approved=true`. This is an acknowledgement of existing human
approval, not a way to create it.

For this review, the course has confirmed that the reviewer saw the marked preview,
and the human subsequently said `approve marker-free replacement` for the existing
Pages URL. Main then published the clean replacement in
[successful run 45807100697](https://github.com/Sakadin/mega-s01e04-rig/actions/runs/45807100697).
Main and the cleanup worker independently fetched the unchanged URL anonymously:
HTTP 200, exact local/public byte match (2206 bytes), original marker absent and
`no marker set` present. The five jobs, one bad line and both warnings remain, with
no client scripts. The run's clean capture succeeded, marked capture was skipped
and zero artifacts remain. The original preview worker closed #6 after review was
confirmed, preserving its original closing comment; see [the follow-up](https://github.com/Sakadin/mega-s01e04-rig/issues/6#issuecomment-7190224514).

The clean capture step never receives the marker secret, forces an empty marker and
does not load `.env`. It deploys a new `index.html` over the **same Pages root URL**.
Verify the public banner reads `no marker set` and the old marker is absent. The
workflow has no push-based or timed cleanup trigger. Replacing the file removes it
from the current site, but cannot recall copies a public reader already downloaded.
Confirm that the deployment run retains zero artifacts. The
[archived plan](plans/done/morning-digest.md) is now `done` and records the public
run URL and verified SHA-256. Exact worker verification output and the sourced
review/approval history are in KEEP.md; preview HTML and the actual marker remain
outside Git. After main integrated and pushed the final archive commit, the cleanup
worker posted [the required closing comment](https://github.com/Sakadin/mega-s01e04-rig/issues/7#issuecomment-7190384762)
and closed #7. The course then accepted the unchanged final answer as solved.

## Validated action/API contracts

These are official GitHub documentation or the action owners' versioned source;
use the exact output names, not those of an underlying action:

| Contract | Source |
| --- | --- |
| `checkout@v6`, `configure-pages@v5`, `upload-pages-artifact@v4`, `deploy-pages@v4`; Pages permissions/environment and single-job deployment | [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) |
| Checkout `persist-credentials: false` | [checkout v6 action.yml](https://github.com/actions/checkout/blob/v6/action.yml) |
| Node 24, `package-manager-cache: false`, no `cache` input | [setup-node v6 action.yml](https://github.com/actions/setup-node/blob/v6/action.yml) |
| Exact `version`, `run_install: false`, `cache: false` | [pnpm/action-setup v4 action.yml](https://github.com/pnpm/action-setup/blob/v4/action.yml) |
| Pages configuration without enabling/changing the host | [configure-pages v5 action.yml](https://github.com/actions/configure-pages/blob/v5/action.yml) |
| Upload `name`, directory `path`, `retention-days`; **`artifact_id`** output (underscore) | [upload-pages-artifact v4 action.yml](https://github.com/actions/upload-pages-artifact/blob/v4/action.yml) |
| Deploy matching `artifact_name`; **`page_url`** output; public Pages deployment, not alpha `preview` mode | [deploy-pages v4 action.yml](https://github.com/actions/deploy-pages/blob/v4/action.yml) |
| Exact-ID `DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}`; success is HTTP 204 | [GitHub artifact REST API](https://docs.github.com/en/rest/actions/artifacts#delete-an-artifact) |

The deployment job grants only `contents: read`, `pages: write`, `id-token: write`,
and `actions: write` (artifact deletion). All other permissions are unset.
