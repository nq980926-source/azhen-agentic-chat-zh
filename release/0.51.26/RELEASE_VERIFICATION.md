# 0.51.26 release verification

Accepted functional base: 0.51.26-ui-test.1 / 08b8741cddd8b5af1c0e2c4726d70824410aafb0.
The user authorized formal promotion after reporting Android device acceptance: 6 of 6 passed. Windows automated and real desktop environment evidence passed; Windows manual acceptance has NOT been completed. The user explicitly waived additional Windows manual acceptance for this release.

Only manifest.json, package.json, package-lock.json, versions.json and release/0.51.26 documentation change from the accepted commit. No source, CSS, dependencies, tests or business logic changes. Previously published test reports remain historical records.

Fresh production build: npm run build passed, including typecheck, verify-release and verify-mobile-compat. Version/manifest/lock consistency passed. The freshly built main.js and tracked styles.css match freshly downloaded accepted GitHub release assets byte for byte:

- main.js: SHA-256 75b648523b7895d5ac377cbb5fe06d865f13669ee90386cd470e01b5128f2bc8
- styles.css: SHA-256 a38ff7f33da74994badbb4f4d2c4ab30a30ad35341c3b6950d55b9147c7d6b93

Plugin id: agentic-chat. Version: 0.51.26. Minimum Obsidian: 1.11.4. isDesktopOnly: false. Windows and Android share the same plugin package.

The ZIP contains agentic-chat/main.js, manifest.json, styles.css, LICENSE and THIRD_PARTY_NOTICES.md. ZIP CRC and content equality are checked before publication. Raw BRAT assets match ZIP entries. SHA256SUMS.txt covers all delivery artifacts except itself; GitHub asset digests and downloaded files are checked before formal publication.

Behavioral evidence is inherited unchanged from the byte-identical accepted build: 107 focused unit tests passed; 188 regression files / 1892 tests passed and 1 existing skip after excluding 6 files already failing on 0.51.25. The complete test suite is not claimed green. Scripted real Obsidian desktop and 390x844 viewport probes each passed 13 checks. See release/0.51.26-ui-test.1/TEST_REPORT.md for baseline failure details. No new device or behavioral tests are claimed for this metadata-only promotion.

Publication: non-Draft, non-Pre-release, Latest=0.51.26. Preserve release ids/tags/assets for 0.51.25 and 0.51.26-ui-test.1 for BRAT rollback. The operator must verify these GitHub states after publication.
