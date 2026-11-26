# Final one-shot incident inspection

User limit: one combined read-only diagnosis and at most one final deployment.
No application/deployer fix is included in this diagnostic ZIP. Client RC.1,
tlsfix.1, COS/CAM/CORS/TLS configuration and Latest are unchanged.

Use the existing /var/backups/azhen-photos-production/CURRENT manifest and SQLite
snapshot, root-owned published release files, bounded unit journal, current
service properties and one loopback health GET. Compare original hashes, file
permissions, enable states and restored service health. SQLite snapshot access
uses mode=ro&immutable=1; the live database is not opened by this utility.

The service-account helper inspects dependencies and the same SDK constructors
as tlsfix.1. It loads existing service credentials only inside that process,
never outputs values, and installs an audit hook forbidding writes, database
access, subprocesses and networking. No COS requests, signed URLs, new photo
objects, pair codes or device tokens are generated.

Only whitelisted event categories, status codes and bounded error enums reach
stdout. Raw journal lines, command arguments, exception messages and sensitive
configuration never reach stdout. Download/extraction only use a private /tmp
directory; the utility does not apply, restart, reload or restore anything.

Return the entire single JSON result without manually searching logs. The
generic prior error discarded the original exception: if retained evidence
cannot establish the cause, report NOT_PROVEN and stop this project. A startup
timing gap is a source defect, not proof of the incident cause. A failed rollback
check means recovery takes priority over feature deployment. No further round
of diagnostics or speculative repair is proposed.

Verification is limited to four privacy/syntax/read-only diagnostic checks and
artifact integrity; no old regressions, Mock COS or deployment retry.
