# @myhumblecoder/appstore

App Store submission toolkit for native iOS apps (SwiftUI + XcodeGen).

```bash
npx @myhumblecoder/appstore doctor          # can this machine build, sign and ship?
npx @myhumblecoder/appstore check           # is this build fit to submit?
npx @myhumblecoder/appstore check --static  # the CI half: no network, no gates
```

## Why

Shipping a first iOS app spends most of its time on mechanics that are invisible
until they bite, and none of them are app-specific:

- **`TARGETED_DEVICE_FAMILY` is universal by default.** Nobody types `"1,2"`, so an
  iPad-capable binary ships while the review notes promise iPhone only. That makes iPad
  screenshots a *required* upload and puts the app in front of a reviewer on a device it
  was never opened on. Every test passes the whole time.
- **`CFBundleVersion` hardcoded to `"1"`** works for exactly one upload; App Store
  Connect rejects a build number it has seen.
- **`xcodebuild archive` without `-allowProvisioningUpdates`** will not ask Apple for a
  profile it lacks, and silently signs a Release archive with the *development*
  certificate instead.
- **A keychain prompt nobody sees** fails an archive as `errSecInternalComponent`,
  hundreds of lines into a log.
- **Screenshot slots reject anything but exact pixel sizes**, and the device→size
  mapping is not guessable from device names.

## The rule this package is built on

**A check reports what it measured, never what it expected.**

That is not a style preference. In the work that produced this package, three separate
failures were tools asserting things they never read — a hardcoded version string, a
hardcoded "wants 1320x2868" footer printed under differently-sized files, and a log tail
that read as success while the run had died and left stale output on disk. Each looked
like confirmation. The measured checks were right every time.

So every passing line prints the value behind it:

```
  ✓ device family iphone  TARGETED_DEVICE_FAMILY = 1
  ✓ bundle id  ai.botguild.app
```

and every failure prints what was actually there:

```
  ✗ device family must be iphone (TARGETED_DEVICE_FAMILY = 1)
      observed: 1, 1,2 — every target must agree, including test bundles
```

## Configuration

`appstore.config.json` in the repo root:

```json
{
  "bundleId": "ai.example.app",
  "projectDir": "ios",
  "scheme": "Example",
  "appTarget": "Example",
  "deploymentTarget": "17.0",
  "deviceFamily": "iphone",
  "urlSchemes": ["example"],
  "capabilities": { "push": true },
  "checks": {
    "noInAppViewer": true,
    "noThirdPartySignIn": ["ios/Example/Sources/SignInView.swift"],
    "noBackgroundModes": true
  },
  "gates": ["node scripts/seed-demo-data.mjs"]
}
```

`gates` are repo-specific commands run by a full `check` — the place for anything true of
your app but not of apps in general.

## What `check` verifies

| Check | Why it matters |
|---|---|
| device family | the universal default, above |
| bundle id | must match the App ID any APNs topic is issued for |
| deployment target | must agree with what the listing claims |
| `ITSAppUsesNonExemptEncryption` | absent means every upload stops on the encryption question |
| no `UIBackgroundModes` | declaring it without a handler is a review flag |
| URL schemes | an OAuth callback with nothing to match on fails silently |
| `aps-environment` | without it the build cannot receive push |
| icon alpha channel | App Store Connect rejects the upload outright |
| no in-app content viewer | guideline 3.1.3(e) |
| no third-party sign-in | a social button triggers guideline 4.8 |

## What `doctor` verifies

Certificates (distinguishing **Apple Distribution** from **Apple Development** — having
one implies nothing about the other), the team id **read from provisioning profiles**
rather than the signing identity, whether `codesign` will raise a keychain prompt,
simulator health with `--fix`, and App Store Connect credentials.

> The parenthetical in `Apple Development: Name (XXXXXXXXXX)` is the *individual's* id.
> It looks exactly like a Team ID and is a different value. Suggesting it sends you round
> a loop of signing errors that all blame the wrong thing.

## Status

`check` and `doctor` ship today. `screenshots`, `archive` and `metadata` are ported next
— see the repo issues.

## Licence

MIT
