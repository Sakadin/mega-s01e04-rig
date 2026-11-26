---
plan: morning-digest
status: ready
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

## Completion gate

This archive is prepared on the cleanup worker branch; its location does not mean
the plan is finished. The original requirements above are preserved, and `status`
remains `ready` until main independently verifies public cleanup and integrates
the archive. Submission alone did not satisfy the review gate for #6; the course
required the reviewer to have seen the page. See [the preview guide](../../preview.md)
and the sourced review/approval findings in [KEEP.md](../../../KEEP.md).

- [x] The course confirmed that the reviewer has seen the marked preview.
- [x] The human separately approved a marker-free replacement at the existing URL.
- [ ] Main publishes the clean replacement at that same URL and independently
  verifies an anonymous HTTPS response has `no marker set`, no lane marker and the
  unchanged sample digest; the deployment run retains zero artifacts.
- [ ] Main records the verification evidence, integrates this archive and changes
  `status` to `done` only after the public gate holds. #7 stays open until its full
  Done when holds; #6 remains the original preview worker's responsibility.
