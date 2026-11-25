# Optional private photos

## Sub-features

- Explicit per-request selection and private COS persistence; no automatic image mirroring.
- Stable photoId Markdown, native Reading View and existing chat rendering.
- In-memory display cache and idempotent task metadata on the current device.

## How to get to it (user view)

Enable COS client in Agent settings and select a local SecretStorage token; sent chat photos offer 保存照片至 COS. The save_photos tool also opens the same explicit approval. Select each photo, confirm, then copy or insert confirmed references.

## Driving it with the probe harness

Run npm run verify -- e2e test/e2e/specs/private-photos.e2e.ts in an isolated vault. The spec substitutes only the transport with Mock COS and uses the original chat and Markdown APIs. No production cloud requests.

## Proof

| entry point | source | proof | status |
|---|---|---|---|
| Photo settings and SecretStorage | `src/photos/settings.ts:4` | `test/e2e/specs/private-photos.e2e.ts:150` (scripted Windows / mobile emulation; actual Android pending) | `partial` |
| Sent chat photo save button and per-photo approval | `src/ui/chat-view.ts:3165` | `test/e2e/specs/private-photos.e2e.ts:80` (scripted Windows / mobile emulation; actual Android pending) | `partial` |
| AI save_photos (YOLO still asks) | `src/photos/tool.ts:15` | `test/e2e/specs/private-photos.e2e.ts:127` (scripted Windows / mobile emulation; actual Android pending) | `partial` |
| Reading View and chat Markdown | `src/photos/renderer.ts:71` | `test/e2e/specs/private-photos.e2e.ts:94` (scripted Windows / mobile emulation; actual Android pending) | `partial` |
| Offline retry and resource release | `src/photos/renderer.ts:43` | `test/e2e/specs/private-photos.e2e.ts:107` (scripted Windows / mobile emulation; actual Android pending) | `partial` |
| Session/tab interruption | `src/photos/tasks.ts:39` | `test/e2e/specs/private-photos.e2e.ts:143` (scripted Windows / mobile emulation; actual Android pending) | `partial` |

## Gotchas

- Production prefix, CAM, trusted TLS, CORS and feature switches require separate authorization. Mock confirmed is not real COS acceptance.
- Android device and provider live tests remain pending. Mobile emulation is not Android hardware.
- Source Mode preserves the literal reference. Live Preview is separately observed; Reading View is the supported image display surface for this candidate. No editor extension or second note reader.
- Local/cloud knowledge boundary, Memory, web search, models and existing chat history remain independent.
- No Markdown goes to COS. No permanent signed URLs, credentials or photo bytes in task metadata. No disk image cache or new sync.
