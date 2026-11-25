# Daily private photos

## Sub-features

Original bytes: 10 MiB each, 4 photos / 40 MiB batch. Per-device pairing; stable photoId. Native Live Preview and Reading View reuse one renderer/cache. Existing local Vault safety remains unchanged.

## How to get to it (user view)

Pair once per device in photo settings. On a Markdown note use the ribbon image button, command `agentic-chat:save-note-photos`, or settings picker. Explicitly approve each selection; confirmed references append to the approved note. Sent chat save and save_photos keep the same approval gate.

## Driving it with the probe harness

Use the isolated native spec `test/e2e/specs/photos-daily-ui.e2e.ts`, desktop or mobile viewport, with no production/COS calls. Direct commands `node scripts/build-e2e.mjs` then `node --import tsx scripts/run-e2e.ts --spec test/e2e/specs/photos-daily-ui.e2e.ts` avoid the existing Windows path-with-spaces issue in the generic wrapper; that wrapper was not refactored.

## Proof

| entry point | source | proof | status |
|---|---|---|---|
| Native note command and unpaired guard | `src/photos/runtime.ts:32` | `test/e2e/specs/photos-daily-ui.e2e.ts:8` actual Obsidian, note remains unchanged | `covered` |
| One-time device form UI | `src/photos/settings.ts:5` | `test/e2e/specs/photos-daily-ui.e2e.ts:21` actual Obsidian; not a cloud pairing claim | `covered` |
| Native preview renderer wiring | `src/photos/editor.ts:8` | `test/e2e/specs/photos-daily-ui.e2e.ts:29` actual Obsidian; production pixels not claimed | `partial` |
| File and batch bounds | `src/photos/limits.ts:4` | `test/photos/daily-limits.test.ts:8` native crypto and byte contract | `partial` |

## Gotchas

Photo pairing requires Obsidian 1.11.5+ at-rest secret storage, while the rest of the plugin keeps its original floor. Device secret references and enable flags are local-only, not Vault settings. Standalone Live Preview photo references become editable text on the cursor line; fenced code/frontmatter/Source Mode remain literal.

Production CAM, namespace, CORS, persistent service/backup/renewal units require the single approval in `server/photos/PRODUCTION_CHANGE_REQUEST.md`. Old temporary single-image scripts are retired for production. No production credentials, URLs, image payloads or sessions belong in commits. See `docs/releases/0.51.28-rc.1.md` for offline/backup limits; no production upload success is claimed by these UI/byte proofs.
