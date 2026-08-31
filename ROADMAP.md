# Roadmap

Extracted from `botguild-platform` after a day spent getting a first iOS app to a
validated TestFlight build, where almost none of the time went into the app. Phase 1
shipped; the rest is ordered by value, and the ordering is load-bearing.

## Shipped — phase 1

`appstore check` and `appstore doctor`, plus the config layer and the `Report` type that
enforces the rule the whole package is built on: **a check reports what it measured,
never what it expected.**

Verified against `botguild-platform`: reproduces its `preflight.sh` output (11 checks),
and removing `TARGETED_DEVICE_FAMILY` from `project.yml` fails it with exit 1 and
`observed: 1, 1,2`.

## Phase 2 — `appstore screenshots`

Port `ios/Tools/screenshots.sh`. Capture via XCUITest into a per-slot directory, then
verify rather than assume:

1. **Assert dimensions** against a device table held as data.
2. **Sample pixels** against `screenshots.themeBackground` and fail on any row that is
   not the page ground.

Step 2 is not decoration. A chat screen rendered on `rgb(0,0,0)` instead of the theme's
`rgb(2,6,23)` and survived a commit that specifically claimed to fix it, five screenshot
reviews, and a direct visual inspection of that exact frame. On a phone, in a normal
room, those two colours are the same colour. Only sampling told them apart.

The capture step must also fail loudly when it produces nothing. Two runs during the
original work died in three seconds on simulator failures (`Launchd job spawn failed`,
then `Mach error -308 (ipc/mig) server died` — two different wedges) and left the
*previous* frames on disk, where a log tail read as success.

Device table, both accepted sizes per slot:

| Device | Size | Slot |
|---|---|---|
| iPhone 17 / 16 Pro Max | 1320×2868 | 6.9" |
| iPhone 14 Pro Max | 1290×2796 | 6.9" (alternate) |
| iPhone 13 / 12 Pro Max | 1284×2778 | 6.5" |
| iPhone 11 Pro Max | 1242×2688 | 6.5" (alternate) |

An unknown device is an error, not a guess. Device names do not track sizes, and guessing
costs a full capture run.

## Phase 3 — `appstore archive`

Port `ios/Tools/archive.sh`.

- **`-allowProvisioningUpdates` is not optional** on either the archive or export step.
  Without it `xcodebuild` will not ask Apple for a profile it lacks and silently falls
  back to whatever is on disk — which signed a Release archive with the *development*
  certificate and profile, and only failed much later.
- Build number from the git commit count: monotonic, stateless, and it cannot collide
  with itself after a rejected upload the way a hand-typed number does.
- Version and build read from the **built app inside the archive**. No fallback
  constants — a hardcoded fallback is what printed `Version: 0.1.0` for a build
  correctly stamped `1.0`.
- Fail early and explain when the Apple Distribution certificate is missing, rather than
  four hundred lines into an export log.

## Phase 4 — `appstore metadata`

Port `scripts/appstore-metadata.mjs`. Already written and working in
`botguild-platform`; mostly a move.

- ES256 JWT via `node:crypto`, `dsaEncoding: "ieee-p1363"`. OpenSSL's DER default is a
  silent 401.
- Copy extracted from `STORE-LISTING.md` and `REVIEW-NOTES.md`, so those files become
  the listing rather than a draft of it.
- Character limits checked before pushing; Apple enforces them at submission, which is
  the worst moment to learn a paragraph is eight characters too long.
- Read-only diff is the default and exits non-zero on drift.
- **No code path may touch `appStoreVersionSubmissions`.** Submitting stays a human
  decision.

Still missing, and the one piece with no working reference implementation: screenshot
*upload*, a three-step reserve/upload/commit with per-image checksums.

## Phase 5 — migrate `botguild-platform`

Deliberately last, and **skippable if a second iOS app never materialises.**

BotGuild is currently the only consumer, so migration buys nothing on its own — it is
churn against a working setup. Its value is entirely in the second app: it proves the
config abstraction holds before anything depends on that, and it stops two copies
diverging.

Blocked on phases 2–4. Deleting `archive.sh` before `appstore archive` exists would
remove a capability in active use.

1. Commit `appstore.config.json` (drafted and verified, not yet committed).
2. Replace `ios/Tools/*.sh` and `scripts/appstore-metadata.mjs` with CLI calls — about
   700 lines deleted.
3. Point `.github/workflows/ios.yml:66` at `appstore check --static`.
4. Keep `scripts/seed-ios-demo.mjs`; it is marketplace logic, wired in through `gates`.
5. Delete each original only after the CLI reproduces its output on this repo — literally
   diffed, not assumed.

**Pin the version in CI.** Floating on `@latest` means a bug here breaks BotGuild's CI
with no change to that repo, which is the failure mode a shared package exists to
prevent, arriving from the other direction.

## Phase 6 — `appstore init`

Scaffold config and doc templates. Deliberately last: what a second app actually needs is
not knowable until there is one, and guessing now would bake BotGuild's shape into the
template.
