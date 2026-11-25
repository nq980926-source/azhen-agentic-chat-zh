import { describe, it, expect, vi } from 'vitest';
import { PhotoClient, DEFAULT_PHOTOS, PHOTO_HOST, PHOTO_PREFIX, PhotoError, validateObjectGrant, photoReference, parsePhotoReference, photoWire, healPhotos, type Grant, type Intent, type PhotoWire, type UploadParameters } from '../../src/photos/client';
import { PhotoTasks, type PhotoTask, type PhotoSource } from '../../src/photos/tasks';
import { PhotoCache } from '../../src/photos/cache';
import { bytesFromBase64, contentMd5, sha256 } from '../../src/photos/digests';
import { createPhotoTool, sourceFromMessage } from '../../src/photos/tool';
import { mergeSettings } from '../../src/settings';
const id='11111111-1111-4111-8111-111111111111';
const op='22222222-2222-4222-a222-222222222222';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRl0AAAAASUVORK5CYII=';
const bytes=bytesFromBase64(png);
const source:PhotoSource={key:'session:one',images:[{name:'one.png',data:png,mimeType:'image/png',size:bytes.length},{name:'two.png',data:png,mimeType:'image/png',size:bytes.length}]};
const settings={...DEFAULT_PHOTOS,enabled:true};
function grant(method:'PUT'|'GET', headers:Record<string,string>={}):Grant {
 const q=new URLSearchParams({'q-sign-algorithm':'sha1','q-ak':'syntheticCredentialId','q-sign-time':'100;200','q-key-time':'100;200','q-header-list':['host',...Object.keys(headers)].sort().join(';'),'q-url-param-list':'','q-signature':'a'.repeat(40)});
 return {method,url:`https://${PHOTO_HOST}/${PHOTO_PREFIX}photos/v1/${'a'.repeat(24)}/${id}/original.png?${q}`,headers,expiresAt:200,serverTime:100};
}
async function fixture(){
 let data:UploadParameters; let confirmed=false; let stored:PhotoTask[]=[];
 const digest=await sha256(bytes);
 const make=():Intent=>({operationId:data?.operationId??op,photoId:id,state:confirmed?'confirmed':'reserved',bytes:bytes.length,mime:'image/png',sha256:digest});
 const wire=vi.fn<PhotoWire>(async (url,method,_headers,body)=>{
  if(url.startsWith(`https://${PHOTO_HOST}/`))return {status:200,body:method==='GET'?bytes.slice().buffer:new ArrayBuffer(0)};
  const payload=body?JSON.parse(new TextDecoder().decode(body)):{};
  if(url.endsWith('/uploads')){
   data=payload;
   const h={'content-type':data.mime,'content-length':String(data.bytes),'content-md5':data.contentMd5,'x-cos-forbid-overwrite':'true','x-cos-meta-sha256':data.sha256,'x-cos-meta-content-md5':data.contentMd5,'x-cos-acl':'private'};
   return json({...make(),authorization:grant('PUT',h)});
  }
  if(url.endsWith('/complete')){confirmed=true;return json(make());}
  if(url.endsWith('/read-authorizations'))return json([{...make(),state:'confirmed',authorization:grant('GET')}]);
  throw new Error('UNEXPECTED MOCK REQUEST');
 });
 const client=new PhotoClient(()=>settings,()=> 'synthetic-local-client-token-only-000',wire);
 const store={load:()=>stored,save:(value:PhotoTask[])=>{stored=value;}};
 const tasks=new PhotoTasks(client,store,()=>true);
 return {wire,client,tasks,store,make,get stored(){return stored;}};
}
function json(data:unknown){return {status:200,body:new TextEncoder().encode(JSON.stringify({data})).buffer};}

describe('photo client network boundary',()=>{
 it('accepts exact scoped GET and SDK percent-encoded query separators',()=>expect(validateObjectGrant(grant('GET'),'GET',id,settings)).toContain(PHOTO_HOST));
 it.each([
  (g:Grant)=>({...g,url:g.url.replace('https:','http:')}),
  (g:Grant)=>({...g,url:g.url.replace(PHOTO_HOST,PHOTO_HOST+'.attacker.invalid')}),
  (g:Grant)=>({...g,url:g.url.replace(PHOTO_PREFIX,'isolated-test/run/')}),
  (g:Grant)=>({...g,url:g.url.replace(id,op)}),
  (g:Grant)=>({...g,url:g.url.replace('/original.png','/%2e%2e/original.png')}),
  (g:Grant)=>({...g,url:g.url+'#x'}),
  (g:Grant)=>({...g,url:g.url+'&redirect=https://attacker.invalid'}),
  (g:Grant)=>({...g,url:g.url+'&q-ak=other'}),
  (g:Grant)=>({...g,headers:{Authorization:'synthetic-private'}}),
  (g:Grant)=>({...g,expiresAt:1000}),
 ])('rejects unexpected URL, header, object, or lifetime %#',(change)=>expect(()=>validateObjectGrant(change(grant('GET')),'GET',id,settings)).toThrow(PhotoError));
 it('never invokes a transport when disabled or token is absent',async()=>{
  const wire=vi.fn();const c=new PhotoClient(()=>DEFAULT_PHOTOS,()=>'',wire);
  await expect(c.read(id)).rejects.toThrow('disabled');expect(wire).not.toHaveBeenCalled();
 });
 it('masks unsafe transport exceptions and response body',async()=>{
  const c=new PhotoClient(()=>settings,()=> 'synthetic-local-client-token-only-000',async()=>{throw new Error('Bearer private q-signature=private');});
  try {await c.read(id);throw new Error('expected failure');}catch(e){expect(String(e)).not.toMatch(/Bearer|q-signature|private/);}
 });
 it('uses abortable no-redirect no-cookie no-cache HTTPS transport',async()=>{
  const fetcher=vi.fn(async (_url:string, _init?:RequestInit)=>{const r=new Response(new Uint8Array([1,2]));Object.defineProperty(r,'url',{value:'https://example.invalid/'});return r;});vi.stubGlobal('fetch',fetcher);
  try {const r=await photoWire('https://example.invalid/', 'GET',{},undefined,undefined,3);expect(r.body.byteLength).toBe(2);expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});}finally{vi.unstubAllGlobals();}
 });
 it('bounds downloaded response size',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Object.defineProperty(new Response(new Uint8Array(8)),'url',{value:'https://example.invalid/'})));
  try{await expect(photoWire('https://example.invalid/','GET',{},undefined,undefined,4)).rejects.toThrow('response_too_large');}finally{vi.unstubAllGlobals();}
 });
 it('checks returned photo identity and rejects hash mismatch',async()=>{
  const f=await fixture();const v=f.wire.getMockImplementation()!;
  f.wire.mockImplementation(async(...args)=>args[0].startsWith(`https://${PHOTO_HOST}`)?{status:200,body:new Uint8Array(bytes.length).buffer}:v(...args));
  await expect(f.client.read(id)).rejects.toThrow('read_integrity_mismatch');
 });
 it('reads identical bytes for the same stable photoId across independent clients',async()=>{
  const f=await fixture();const other=new PhotoClient(()=>settings,()=> 'synthetic-local-client-token-only-000',f.wire);
  expect((await f.client.read(id)).bytes).toEqual((await other.read(id)).bytes);
 });
});
describe('per-request photo approval and recovery',()=>{
 it('does nothing on construction, refresh, or refusal',async()=>{
  const f=await fixture();new PhotoTasks(f.client,f.store,()=>true);
  expect(f.wire).not.toHaveBeenCalled();expect(await f.tasks.save(source,async()=>null)).toEqual([]);expect(f.wire).not.toHaveBeenCalled();
 });
 it('only uploads approved subset and returns a server-confirmed reference',async()=>{
  const f=await fixture();const result=await f.tasks.save(source,async()=>[1]);
  expect(result).toHaveLength(1);expect(result[0]).toMatchObject({index:1,status:'confirmed',reference:photoReference(id)});
  expect(f.wire.mock.calls.filter(c=>c[1]==='PUT')).toHaveLength(1);
  expect(JSON.stringify(f.stored)).not.toContain(png);expect(JSON.stringify(f.stored)).not.toContain('q-sign');expect(JSON.stringify(f.stored)).not.toContain('Bearer');
 });
 it('preserves success through reloading and reapproval without another PUT',async()=>{
  const f=await fixture();await f.tasks.save(source,async()=>[0]);const count=f.wire.mock.calls.length;
  const reloaded=new PhotoTasks(f.client,f.store,()=>true);await reloaded.save(source,async()=>[0]);expect(f.wire).toHaveBeenCalledTimes(count);
 });
 it('requires new approval for every retry and reuses operation id after uncertain PUT',async()=>{
  const f=await fixture();const v=f.wire.getMockImplementation()!;let fail=true;
  f.wire.mockImplementation(async(...args)=>{if(args[1]==='PUT'&&fail){fail=false;throw new Error('unsafe network URL');}return v(...args);});
  const first=await f.tasks.save(source,async()=>[0]);expect(first[0].status).toBe('failed');expect(first[0].reference).toBeUndefined();
  const count=f.wire.mock.calls.length;await f.tasks.save(source,async()=>null);expect(f.wire).toHaveBeenCalledTimes(count);
  const second=await f.tasks.save(source,async()=>[0]);expect(second[0].operationId).toBe(first[0].operationId);expect(second[0].status).toBe('confirmed');
  expect(f.wire.mock.calls.filter(c=>c[1]==='PUT')).toHaveLength(1);
 });
 it('does not issue authorization if the session changes during approval',async()=>{
  const f=await fixture();let valid=true;
  expect(await f.tasks.save(source,async()=>{valid=false;return [0];},undefined,()=>valid)).toEqual([]);expect(f.wire).not.toHaveBeenCalled();
 });
 it('stops between authorization and PUT when interrupted',async()=>{
  const f=await fixture();const controller=new AbortController();const v=f.wire.getMockImplementation()!;
  f.wire.mockImplementation(async(...args)=>{const out=await v(...args);controller.abort();return out;});
  await f.tasks.save(source,async()=>[0],controller.signal);expect(f.wire.mock.calls.filter(c=>c[1]==='PUT')).toHaveLength(0);
 });
 it('aborted and unanswered approvals never authorize',async()=>{
  const f=await fixture();const controller=new AbortController();controller.abort();await f.tasks.save(source,async()=>[0],controller.signal);expect(f.wire).not.toHaveBeenCalled();
 });
 it('refuses malformed selections and unmatched source bytes',async()=>{
  const f=await fixture();await expect(f.tasks.save(source,async()=>[0,0])).rejects.toThrow('invalid_approval');
  await expect(f.tasks.save({...source,images:[{...source.images[0],size:1}]},async()=>[0])).rejects.toThrow('image_source_mismatch');expect(f.wire).not.toHaveBeenCalled();
 });
 it('fails closed if operation metadata cannot be saved',async()=>{
  const f=await fixture();const tasks=new PhotoTasks(f.client,{load:()=>[],save:()=>{throw new Error('disk failure');}},()=>true);
  const result=await tasks.save(source,async()=>[0]);expect(result[0].status).toBe('failed');expect(f.wire).not.toHaveBeenCalled();
 });
 it('does not invent references on service failure',async()=>{
  const f=await fixture();f.wire.mockResolvedValue({status:503,body:new ArrayBuffer(0)});
  const result=await f.tasks.save(source,async()=>[0]);expect(result[0].status).toBe('failed');expect(result[0].reference).toBeUndefined();
 });
 it('rejects old execution in cloud mode even after tool discovery',async()=>{
  const f=await fixture();const tasks=new PhotoTasks(f.client,f.store,()=>false);await expect(tasks.save(source,async()=>[0])).rejects.toThrow('local_mode_required');expect(f.wire).not.toHaveBeenCalled();
 });
});
describe('photo references, settings, cache and tool',()=>{
 it('defaults off and heals only known nonsecret configuration',()=>{
  expect(mergeSettings(null).photos).toEqual(DEFAULT_PHOTOS);expect(mergeSettings({knowledgeMode:'local'}).photos.enabled).toBe(false);
  expect(healPhotos({enabled:true,endpoint:'http://attacker.invalid',authToken:'neverpersist'})).toEqual(settings);
 });
 it('keeps stable references readable and rejects malformed ids',()=>{
  expect(photoReference(id,'caption')).toBe(`![caption](azhen-photo://v1/${id})`);expect(parsePhotoReference(`azhen-photo://v1/${id}`)).toBe(id);expect(parsePhotoReference(`azhen-photo://v1/${id}?token=x`)).toBeNull();expect(()=>photoReference('../x')).toThrow();
 });
 it('uses browser SHA and Content-MD5 fixtures',async()=>{expect(await sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');expect(contentMd5(new TextEncoder().encode('abc'))).toBe('kAFQmDzST7DWlj99KOF/cg==');});
 it('deduplicates repeated references, releases object URLs and expires idle memory',async()=>{
  const f=await fixture();let now=0;const cache=new PhotoCache(f.client,1024,100,()=>now);
  const [a,b]=await Promise.all([cache.acquire(id),cache.acquire(id)]);expect(f.wire).toHaveBeenCalledTimes(2);expect(a.url).toBe(b.url);
  const revoke=vi.spyOn(URL,'revokeObjectURL');a.release();a.release();b.release();expect(revoke).toHaveBeenCalledTimes(1);now=101;expect(cache.byteSize).toBe(0);cache.close();revoke.mockRestore();
 });
 it('caps active display cache and never persists image bytes',async()=>{const f=await fixture();const cache=new PhotoCache(f.client,1);await expect(cache.acquire(id)).rejects.toThrow('display_cache_full');expect(cache.byteSize).toBe(0);cache.close();});
 it('renews one expired GET grant then stops retrying',async()=>{
  const f=await fixture();const v=f.wire.getMockImplementation()!;f.wire.mockImplementation(async(...args)=>args[0].startsWith(`https://${PHOTO_HOST}`)?{status:403,body:new ArrayBuffer(0)}:v(...args));
  const cache=new PhotoCache(f.client);await expect(cache.acquire(id)).rejects.toThrow('read_failed');expect(f.wire.mock.calls.filter(c=>c[0].endsWith('/read-authorizations'))).toHaveLength(2);cache.close();
 });
 it('binds tool to original current-session images and returns no image payload',async()=>{
  const save=vi.fn<import('../../src/photos/tool').SavePhotos>(async()=>[{index:0,status:'confirmed' as const,operationId:op,photoId:id,reference:photoReference(id)}]);
  const message={role:'user' as const,timestamp:10,content:[{type:'image' as const,data:png,mimeType:'image/png'}]};
  const tool=createPhotoTool(save,()=>[message],()=> 'session',()=> 'token',()=>true);
  const result=await tool.execute('x',{purpose:'diary',target:'日记/test.md'});expect(save.mock.calls[0][0].images[0].data).toBe(png);expect(JSON.stringify(result)).not.toContain(png);expect(JSON.stringify(result)).toContain('azhen-photo://v1/');
  expect(sourceFromMessage({role:'user',timestamp:1,content:'text'},'s')).toBeNull();
 });
});
