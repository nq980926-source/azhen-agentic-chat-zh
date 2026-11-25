import base64,io,json,re,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from photo_auth.metadata_store import Store
from photo_auth.devices import Devices,PhotoVerifier
from photo_auth.schema import Limits,Problem
from photo_auth.service import Service
from photo_auth.app import App
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'deploy'))
from tls_renew import safe_hook

class DailyAuth(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.store=Store(Path(self.tmp.name)/'metadata.sqlite')
  self.now=[1000.0];self.devices=Devices(self.store,'same-photo-owner',lambda:self.now[0])
 def tearDown(self):self.tmp.cleanup()
 def pair(self,name='Android'):
  code=self.devices.code().replace('-','')
  return self.devices.pair({'code':code,'name':name})
 def test_two_devices_share_photo_owner_but_have_distinct_credentials(self):
  first=self.pair();second=self.pair('Windows')
  self.assertTrue(first['token']!=second['token'])
  self.assertEqual(self.devices.verify('Bearer '+first['token']),'same-photo-owner')
  self.assertEqual(self.devices.verify('Bearer '+second['token']),'same-photo-owner')
 def test_pairing_single_use_and_restart_persistence(self):
  code=self.devices.code().replace('-','');answer=self.devices.pair({'code':code,'name':'Android'})
  with self.assertRaises(Problem):self.devices.pair({'code':code,'name':'Windows'})
  again=Devices(Store(self.store.path),'same-photo-owner',lambda:self.now[0])
  self.assertEqual(again.verify('Bearer '+answer['token']),'same-photo-owner')
 def test_expiration(self):
  code=self.devices.code().replace('-','');self.now[0]+=601
  with self.assertRaises(Problem):self.devices.pair({'code':code,'name':'Android'})
 def test_failed_attempts_are_committed_and_rate_limited(self):
  for _ in range(10):
   with self.assertRaises(Problem):self.devices.pair({'code':'A'*16,'name':'invalid'})
  with self.assertRaises(Problem) as failure:self.pair()
  self.assertEqual(failure.exception.status,429)
 def test_revoking_one_device_preserves_other_device_and_metadata(self):
  first=self.pair();second=self.pair('Windows');self.devices.revoke(first['deviceId'])
  with self.assertRaises(Problem):self.devices.verify('Bearer '+first['token'])
  self.assertEqual(self.devices.verify('Bearer '+second['token']),'same-photo-owner')
  with self.store.transaction() as c:self.assertEqual(c.execute('SELECT count(*) FROM intents').fetchone()[0],0)
 def test_credentials_and_codes_are_not_persisted_in_plaintext(self):
  code=self.devices.code().replace('-','');answer=self.devices.pair({'code':code,'name':'Android'})
  with self.store.transaction() as c:
   values=str([tuple(r) for r in c.execute('SELECT * FROM photo_devices')])+str([tuple(r) for r in c.execute('SELECT * FROM photo_pair_codes')])
  self.assertFalse(answer['token'] in values or code in values)
 def test_pair_endpoint_uses_actual_wsgi_and_sqlite_without_cos_calls(self):
  code=self.devices.code().replace('-','');body=json.dumps({'code':code,'name':'Android'}).encode()
  app=App(Service(self.store,None,lambda:self.now[0]),PhotoVerifier(self.devices),devices=self.devices)
  statuses=[]
  reply=b''.join(app({'PATH_INFO':'/photos/v1/devices/pair','REQUEST_METHOD':'POST','CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(body)),'wsgi.input':io.BytesIO(body)},lambda status,headers:statuses.append((status,headers))))
  self.assertTrue(statuses[0][0].startswith('200'))
  value=json.loads(reply)['data'];self.assertTrue(re.fullmatch('azp_[A-Za-z0-9_-]{43}',value['token']))
  self.assertIn(('Cache-Control','no-store'),statuses[0][1])
 def test_full_size_metadata_is_accepted_and_oversize_rejected(self):
  limits=Limits(file_bytes=10*1024**2,batch_bytes=40*1024**2,batch_count=4)
  service=Service(self.store,None,lambda:self.now[0],limits)
  value={'operationId':'11111111-1111-4111-8111-111111111111','batchId':'22222222-2222-4222-8222-222222222222','bytes':10*1024**2,'mime':'image/png','sha256':'0'*64,'contentMd5':'AAAAAAAAAAAAAAAAAAAAAA==','originalFilename':'original.png'}
  service.validate(value);value['bytes']+=1
  with self.assertRaises(Problem):service.validate(value)
  self.assertEqual(limits.batch_bytes,41943040)
 def test_renewal_hooks_only_allow_scoped_nginx_reload(self):
  def encoded(value):return '__ACME_BASE64__START_'+base64.b64encode(value.encode()).decode()+'__ACME_BASE64__END_'
  self.assertTrue(safe_hook('nginx -t && systemctl reload nginx'))
  self.assertTrue(safe_hook(encoded('/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx')))
  self.assertFalse(safe_hook(encoded('systemctl stop nginx')))
  self.assertFalse(safe_hook('systemctl restart unrelated.service'))

if __name__=='__main__':unittest.main()
