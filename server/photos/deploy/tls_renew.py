"""Reuse the existing IP certificate and ACME account; never print certificate keys."""
import base64,pathlib,re,socket,ssl,stat,subprocess
import existing_tls
P=pathlib.Path
IP='106.55.92.40'
CONF=P('/etc/nginx/conf.d/azhen-mcp-access.conf')
REUSE_FILES=()
def need(ok,code):
 if not ok:raise RuntimeError(code)
def run(args,timeout=600):
 return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
def safe(path):
 info=path.stat()
 need(stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022,'TLS_UNSAFE_FILE')
 return path
def safe_hook(value):
 if not value:return True
 if value.startswith('__ACME_BASE64__START_') and value.endswith('__ACME_BASE64__END_'):
  try:value=base64.b64decode(value[len('__ACME_BASE64__START_'):-len('__ACME_BASE64__END_')],validate=True).decode()
  except Exception:return False
 value=value.replace('/usr/bin/systemctl','systemctl').replace('/bin/systemctl','systemctl').replace('/usr/sbin/nginx','nginx').replace('/sbin/nginx','nginx')
 value=' '.join(value.split())
 return bool(re.fullmatch(r'(?:nginx -t && )?(?:systemctl reload nginx(?:\.service)?|nginx -s reload)',value))
def detect():
 global REUSE_FILES
 text=safe(CONF).read_text()
 names=re.findall(r'(?m)^\s*ssl_certificate\s+["\']?(/[^\s;"\']+)["\']?\s*;',text)
 candidates=[]
 for name in sorted(set(names)):
  path=P(name)
  if run(['openssl','x509','-in',str(safe(path)),'-noout','-checkip',IP],10).returncode==0:candidates.append(path)
 need(len(candidates)==1,'TLS_CERTIFICATE_NOT_UNIQUE')
 certificate=candidates[0]
 if (existing_tls.ROOT/'renewal/azhen-mcp-ip.conf').is_file():
  REUSE_FILES=existing_tls.validate(safe,run,need,safe_hook,certificate)
  return certificate,None
 if str(certificate).startswith('/etc/letsencrypt/live/'):
  certname=certificate.parent.name
  need(re.fullmatch('[A-Za-z0-9.-]+',certname),'TLS_UNSAFE_CERTIFICATE_NAME')
  renewal=P('/etc/letsencrypt/renewal')/(certname+'.conf')
  mode=safe(renewal).read_text()
  need(re.search(r'(?m)^authenticator\s*=\s*(webroot|nginx)\s*$',mode),'TLS_NONSTOP_RENEWAL_REQUIRED')
  executable=next((P(x) for x in ('/usr/bin/certbot','/snap/bin/certbot','/usr/local/bin/certbot') if P(x).is_file()),None)
  need(executable is not None,'TLS_EXISTING_CERTBOT_REQUIRED');safe(executable)
  hooks=re.findall(r'(?m)^[ \t]*(?:pre_hook|post_hook|deploy_hook)[ \t]*=([^\n]*(?:\n[ \t]+[^\n]*)*)',mode)
  need(all(safe_hook(hook.strip()) for hook in hooks),'TLS_EXISTING_HOOK_REQUIRES_REVIEW')
  need(not re.search(r'(?m)^\s+(?:.*\b(?:systemctl|service|kill|pkill)\b)',mode),'TLS_MULTILINE_HOOK_REQUIRES_REVIEW')
  return certificate,[str(executable),'renew','--cert-name',certname,'--force-renewal','--quiet','--no-directory-hooks']
 for suffix in ('_ecc',''):
  home=P('/root/.acme.sh');renewal=home/(IP+suffix)/(IP+'.conf')
  if not renewal.is_file():continue
  text=safe(renewal).read_text()
  def field(name):
   line=re.search(r'(?m)^'+name+r'=(.*)$',text)
   if line is None:return ''
   match=re.fullmatch(r"'([^']*)'[ \t]*",line[1])
   need(match is not None,'TLS_UNSUPPORTED_ACME_CONFIGURATION_FORMAT')
   return match[1]
  if field('Le_RealFullChainPath')!=str(certificate):continue
  webroot=field('Le_Webroot')
  need(webroot.startswith('/') or webroot in ('nginx','nginx:') or bool(re.fullmatch(r'nginx:/etc/nginx/[A-Za-z0-9_./-]+',webroot)),'TLS_NONSTOP_RENEWAL_REQUIRED')
  need(all(safe_hook(field(name)) for name in ('Le_PreHook','Le_PostHook','Le_RenewHook','Le_ReloadCmd')),'TLS_EXISTING_HOOK_REQUIRES_REVIEW')
  executable=safe(home/'acme.sh')
  return certificate,[str(executable),'--renew','-d',IP,'--home',str(home),'--force']+(['--ecc'] if suffix else [])
 raise RuntimeError('TLS_EXISTING_ACME_CONFIGURATION_REQUIRED')
def ensure():
 certificate,command=detect()
 if command is not None and run(['openssl','x509','-in',str(certificate),'-noout','-checkend','172800'],10).returncode!=0:
  need(run(command).returncode==0,'TLS_RENEWAL_FAILED')
  need(run(['nginx','-t'],30).returncode==0,'TLS_NGINX_VALIDATION_FAILED')
  need(run(['systemctl','reload','nginx'],30).returncode==0,'TLS_RELOAD_FAILED')
 need(run(['openssl','x509','-in',str(certificate),'-noout','-checkend','86400'],10).returncode==0,'TLS_LIFETIME_TOO_SHORT')
 with socket.create_connection((IP,443),timeout=15) as connection:
  with ssl.create_default_context().wrap_socket(connection,server_hostname=IP):pass
if __name__=='__main__':
 try:ensure();print('PHOTO_TLS_VALID_RENEWAL_READY')
 except Exception:print('PHOTO_TLS_RENEWAL_NEEDS_ATTENTION_NO_SECRET_DETAILS');raise SystemExit(1)
