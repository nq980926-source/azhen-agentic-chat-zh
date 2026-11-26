# RC.1 service-only TLS fix 1

Client baseline: 0.51.28-rc.1 / 138e4243ae80625f43cbb2b29421d4e0065e8f24.
Installed service directory: /opt/azhen-photo-auth/releases/0.51.28-rc.1-tlsfix.1.

Recognize the existing /etc/azhen-mcp/letsencrypt/renewal/azhen-mcp-ip.conf by
public certificate fingerprint. Validate root-owned unit/drop-in/script files,
the active+enabled azhen-mcp-cert-renew.timer and its matching service, recurring
schedule, existing renew-only Certbot command and safe Nginx reload hooks.
Unknown dynamic commands or unsafe hooks stop before deployment writes. Keep
all details local; never print credentials or private keys.

Reuse the existing timer unchanged. Do not issue or force-renew a certificate,
change domains, stop Nginx, create an ACME account or add a second TLS timer.
Keep the 24-hour certificate lifetime and trusted HTTPS checks. Snapshot the
reviewed renewal configuration/unit/script references into the private deployment
backup, without modifying/restoring the existing TLS mechanism during rollback.

All other RC.1 approved deployment behavior, backup and failure rollback remain.
No repeat console CAM/Bucket/CORS setup, client rebuild or Latest promotion.
The original approved photo-location Windows CORS merge remains in the first
production deployment; this fix introduces no additional CORS change.

Six targeted checks pass using real generated X.509 public certificates and
controlled unit/config files. No COS calls or Mock photo acceptance. Python 3.12
grammar and ZIP integrity verified. Actual server unit validation runs inside
apply; local checks do not assert the unknown live command is already accepted.

After PHOTO_PRODUCTION_READY_NO_OBJECT_REQUESTS, run the installed manage.py
pair once per device (same independent pairing flow as RC.1). Client BRAT version
stays 0.51.28-rc.1. Do not send pairing codes or tokens to chat.
