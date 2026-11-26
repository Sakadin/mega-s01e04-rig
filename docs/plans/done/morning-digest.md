---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Issues

| Section | Issue |
| --- | --- |
| 1. Run log reader | [#1 Read and aggregate nightly run logs](https://github.com/Sakadin/mega-s01e04-rig/issues/1) |
| 2a. Page | [#2 Render the digest page](https://github.com/Sakadin/mega-s01e04-rig/issues/2) |
| 2b. JSON | [#3 Serve digest JSON](https://github.com/Sakadin/mega-s01e04-rig/issues/3) |
| 2c. Board link | [#4 Link nights from the status board](https://github.com/Sakadin/mega-s01e04-rig/issues/4) |
| 2d. Route tests | [#5 Test digest routes](https://github.com/Sakadin/mega-s01e04-rig/issues/5) |
| 3. Preview for review | [#6 Publish and send the review preview](https://github.com/Sakadin/mega-s01e04-rig/issues/6) |
| 4. Clean up | [#7 Remove the marker and archive the plan](https://github.com/Sakadin/mega-s01e04-rig/issues/7) |

## Completion

Public cleanup is complete. Main published the marker-free replacement, and main
and the cleanup worker independently verified the unchanged public URL. The original
requirements above are preserved apart from `status: ready` becoming `status: done`.
See [the preview guide](../../preview.md) and the sourced findings and exact worker
verification output in [KEEP.md](../../../KEEP.md).

- [x] The course confirmed that the reviewer has seen the marked preview.
- [x] The human separately approved a marker-free replacement at the existing URL.
- [x] Main published the clean replacement over the same public URL.
- [x] Independent anonymous HTTPS checks confirmed `no marker set`, no original lane
  marker and the unchanged sample digest; the deployment run retains zero artifacts.
- [x] The plan is archived with all seven actual issue URLs and marked `done` after
  the public cleanup gate passed.

### Public verification

- URL: <https://sakadin.github.io/mega-s01e04-rig/>
- Deployment: [successful run 45807100697](https://github.com/Sakadin/mega-s01e04-rig/actions/runs/45807100697);
  clean capture succeeded, marked capture skipped, zero retained artifacts.
- Anonymous HTTP 200; exact local/public byte match, 2206 bytes.
- SHA-256: `fe0757eead4dd94fe0e5dba0b4a74b51a36a6cd9642982cedc07f5599ef46011`.
- Five sample jobs, one bad line, retry/fail warnings and no client scripts verified.

Submission alone did not satisfy #6's review gate. The original preview worker
closed it only after the reviewer-seen confirmation and preserved its original
closing comment; see [the review-gate follow-up](https://github.com/Sakadin/mega-s01e04-rig/issues/6#issuecomment-7190224514).
#7 remains open until this final archive commit is integrated and published on main,
then receives the required closing comment. Final course acceptance is not a
prerequisite for marking the plan done.
