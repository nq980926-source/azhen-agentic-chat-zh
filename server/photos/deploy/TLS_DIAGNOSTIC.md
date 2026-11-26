# RC.1 TLS recognition diagnostic v1

Baseline: 138e4243ae80625f43cbb2b29421d4e0065e8f24 / 0.51.28-rc.1.

This is a diagnostic attachment, not a replacement production service package.
The existing deployer only recognizes Certbot certificates directly named under
`/etc/letsencrypt/live/`, or two fixed IP directories under `/root/.acme.sh/`
whose installed full-chain path is textually identical to the Nginx certificate.
The reported stop occurs before release installation or production configuration
writes. Do not bypass the renewal safety check.

Upload the hash-verified diagnostic ZIP to `/tmp/` with FinalShell. Extract to a
private temporary directory and run `python3 -B tls_diagnostic.py` as root.
It prints one JSON object with public-certificate fingerprints, relevant renewal
configuration paths, classified challenge/hook conditions, renewal schedules,
Nginx syntax and photo-service status. Return the entire object; do not search
for individual fields or send other logs.

Only whitelisted configuration fields are collected. No private-key, credentials
or account.conf file is opened. Unknown hook/command arguments are not emitted.
No Certbot/acme.sh, hooks, network requests, issue/renew commands, service reload,
restart, configuration writes, database access, COS requests or switch changes
are performed. `nginx -t`, public X.509 inspection, cron listing and systemd
status inspection are the only external commands.

Verification: Python 3.12 grammar and five targeted diagnostic privacy/read-only
checks pass. No COS mocks, old regressions or real-photo operations run.
Production renewal recognition will be fixed after the actual server evidence,
using a new immutable service ZIP; RC.1 client and Latest remain unchanged.
