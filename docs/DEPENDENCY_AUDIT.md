# Dependency audit — 2026-10-23

Explorer follow-up: after adding SDK-compatible native component test tools, the
fresh online report contains **55 affected entries (48 high, 7 moderate)**. The
earlier 33-entry result below is the pre-explorer baseline. The additional entries
include development test-tooling dependency paths; no clean-audit gate is claimed.
See `REPOSITORY_EXPLORER.md` for milestone commands and release limitations.

A fresh online `npm audit --json` initially reported 38 affected package entries
(27 high, 11 moderate). These counts include dependency-chain propagation and are
not counts of independent exploits in PocketOps.

## Applied updates

- Override PostCSS to compatible 8.5.31 or later in the 8.x series. Expo/Tailwind
  previously resolved 8.4.49; every installed PostCSS now resolves to 8.5.31.
- Scope UUID 11.1.1 overrides to Sequelize and Xcode tooling. Their CommonJS
  imports use the retained v1/v4 APIs. Sequelize migration/session tests and Expo
  bundling are used to check compatibility. This deliberately avoids the suggested
  Sequelize downgrade and avoids a global UUID override.

After these updates the online audit reports **33 affected package entries:
26 high and 7 moderate**, with no critical entries. The project is not audit-clean.
CI uploads the current advisory JSON on every run without suppressing individual
advisories. A report step is not a completed security release gate.

## Remaining sources to track

| Dependency                                             | Current constraint and next step                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `braces` through Tailwind/Metro tooling                | The advisory lists no patched version. Do not compile attacker-controlled glob patterns; track upstream fixes and an Expo/NativeWind-compatible migration. |
| `node-forge` through Expo CLI                          | The installed 1.4.0 is affected. Track Expo/upstream fixes; build tooling is not a service for processing untrusted certificates.                          |
| `image-size` through Metro                             | Patched 2.x changes the API consumed by the installed Metro. Upgrade through a compatible Expo/Metro release and rerun native asset/bundle checks.         |
| `decode-uri-component` through Router's `query-string` | Fix requires replacing the old transitive API/version. Upgrade through compatible Router dependencies and verify native/deep-link parsing.                 |
| `postcss-selector-parser` through Tailwind             | Patched 7.x crosses the installed 6.x major boundary. Validate Tailwind/NativeWind compatibility before overriding or migrating.                           |

These findings still require remediation or a documented release risk decision.
Do not run `npm audit fix --force`: the audit's proposed Expo downgrade and major
React Native/Tailwind jumps do not preserve this SDK 54 application stack.
Deprecation notices such as `inflight`, `glob`, `rimraf` and `dottie` are separate
upstream maintenance concerns; they are not removed merely by suppressing warnings.

References: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
[PostCSS advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp),
[image-size advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr),
[decode-uri-component advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr),
[selector-parser advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf),
[node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
