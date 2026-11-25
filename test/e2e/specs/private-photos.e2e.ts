/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated real-app assertions inspect private runtime state. */
import { writeFileSync } from 'node:fs';
import { browser, expect, $, $$ } from '@wdio/globals';
import { before, after, describe, it } from 'mocha';
import { openAgenticChatSettings, selectSettingsTab, closeAgenticChatSettings } from '../support/settings-ui';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRl0AAAAASUVORK5CYII=';
const id='11111111-1111-4111-8111-111111111111';
const note='E2E-private-photo.md';
async function state(){return browser.execute(()=>{const s=(window as any).__PHOTO_E2E__;return {calls:s.calls,uploads:s.uploads,results:s.results};});}
async function closeReceipt(){await browser.keys('Escape');}
async function selectFirstPhoto(){
 // Obsidian mobile's fast-click bridge and desktop mouse emulation can double-toggle. Dispatch one native DOM click to the actual control.
 await browser.execute(()=>document.querySelector<HTMLElement>('.azhen-photo-choice .checkbox-container')!.click());
 await browser.waitUntil(async()=>await $$('.azhen-photo-choice .checkbox-container.is-enabled').length===1);
}
describe('opt-in photos in native Obsidian (Mock COS only)',function(){
 this.timeout(120000);
 before(async function(){
  await browser.execute((image)=>{
   (window as any).__AGENTIC_CHAT_E2E_TURNS__=[{content:[{type:'text',text:'图片理解正常。'}],stopReason:'stop'}];
   (window as any).__AGENTIC_CHAT_E2E_CALLS__=0;
   (window as any).__PHOTO_E2E__={image,calls:[],uploads:0,results:null};
  },png);
  await browser.executeObsidian(async({app})=>{
   app.workspace.getLeavesOfType('agentic-chat-chat-view').forEach(leaf=>leaf.detach());
   const p=(app as any).plugins.plugins['agentic-chat'];
   if(p.settings.photos.enabled)throw new Error('photos must default off');
   p.settings.provider='openai-compatible';p.settings.openaiCompatibleApiKey='synthetic-scripted-only';p.settings.openaiCompatibleBaseUrl='https://api.deepseek.com/v1';p.settings.openaiCompatibleModel='deepseek-flash';p.settings.mode='yolo';p.settings.knowledgeMode='local';p.settings.photos.enabled=true;
   app.secretStorage.setSecret(p.settings.photos.tokenSecretId,'synthetic-private-photos-only-12345678');
   const h=(window as any).__PHOTO_E2E__;h.sources=[];const originalSave=p.photos.save;p.photos.save=async(source:any,...args:any[])=>{h.sources.push({key:source.key,sizes:source.images.map((i:any)=>i.size)});return originalSave(source,...args);};
   let upload:any;
   const base='https://azhen-photos-1301105804.cos.ap-guangzhou.myqcloud.com/private-photos/v1/photos/v1/'+ 'a'.repeat(24)+'/11111111-1111-4111-8111-111111111111/original.png';
   const json=(data:any)=>({status:200,body:new TextEncoder().encode(JSON.stringify({data})).buffer});
   const intent=()=>({operationId:upload.operationId,photoId:'11111111-1111-4111-8111-111111111111',state:'confirmed',bytes:upload.bytes,mime:upload.mime,sha256:upload.sha256});
   const grant=(method:string,headers:Record<string,string>={})=>({method,headers,serverTime:100,expiresAt:200,url:base+'?'+new URLSearchParams({'q-sign-algorithm':'sha1','q-ak':'syntheticID','q-sign-time':'100;200','q-key-time':'100;200','q-header-list':['host',...Object.keys(headers)].sort().join(';'),'q-url-param-list':'','q-signature':'a'.repeat(40)})});
   p.photos.client.wire=async(url:string,method:string,_headers:any,body?:ArrayBuffer)=>{
    h.calls.push({route:url.includes('.myqcloud.com/')?'object':url.split('/photos/v1/')[1],method});
    if(url.includes('.myqcloud.com/')){
     if(method==='PUT'){h.uploads++;h.objectBytes=body;return {status:200,body:new ArrayBuffer(0)};}
     if(h.offline)return {status:503,body:new ArrayBuffer(0)};
     return {status:200,body:h.objectBytes};
    }
    if(url.endsWith('/uploads')){
     upload=JSON.parse(new TextDecoder().decode(body));
     const headers={'content-type':upload.mime,'content-length':String(upload.bytes),'content-md5':upload.contentMd5,'x-cos-forbid-overwrite':'true','x-cos-meta-sha256':upload.sha256,'x-cos-meta-content-md5':upload.contentMd5,'x-cos-acl':'private'};
     return json({...intent(),state:'reserved',authorization:grant('PUT',headers)});
    }
    if(url.endsWith('/complete'))return json(intent());
    if(url.endsWith('/read-authorizations'))return json([{...intent(),authorization:grant('GET')}]);
    throw new Error('mock route missing');
   };
   const old=app.vault.getFileByPath('E2E-private-photo.md');if(old)await app.fileManager.trashFile(old);
   await app.vault.create('E2E-private-photo.md','---\ntitle: diary\n---\n正文保留\n');
   await p.saveSettings();
  });
  await browser.executeObsidianCommand('agentic-chat:open-chat');await $('.agentic-chat-view').waitForExist();
 });
 after(async function(){
  await browser.executeObsidian(async({app})=>{const p=(app as any).plugins.plugins['agentic-chat'];p.photos.changed();const f=app.vault.getFileByPath('E2E-private-photo.md');if(f)await app.fileManager.trashFile(f);app.secretStorage.setSecret(p.settings.photos.tokenSecretId,'');app.saveLocalStorage('agentic-chat-photo-tasks-v1',null);});
 });
 it('ordinary image understanding sends original images once and makes zero COS calls',async function(){
  await browser.execute(()=>{
   const h=(window as any).__PHOTO_E2E__;const bytes=Uint8Array.from(atob(h.image),(c:string)=>c.charCodeAt(0));
   const dt=new DataTransfer();dt.items.add(new File([bytes],'one.png',{type:'image/png'}));dt.items.add(new File([bytes,new Uint8Array([0])],'two.png',{type:'image/png'}));
   const picker=document.querySelector<HTMLInputElement>('.agentic-chat-view input[type=file]')!;picker.files=dt.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await browser.waitUntil(async()=>await $$('.agentic-chat-local-image').length===2);
  await $('.agentic-chat-input').setValue('请分析照片，暂不保存');await $('.agentic-chat-send').click();
  await browser.waitUntil(async()=> (await $('.agentic-chat-messages').getText()).includes('图片理解正常'),{timeout:20000,timeoutMsg:'scripted image turn did not settle'});
  expect((await state()).calls).toHaveLength(0);
  const result=await browser.executeObsidian(({app})=>{const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0]!.view as any;const m=v.service.getMessages().filter((m:any)=>m.role==='user');return {count:m.length,images:m[0].content.filter((p:any)=>p.type==='image').length};});
  expect(result).toEqual({count:1,images:2});expect(await $$('.azhen-photo-save').length).toBe(1);
 });
 it('requires unchecked per-image confirmation and cancellation performs zero authorization',async function(){
  await $('.azhen-photo-save').click();await $('.azhen-photo-approval').waitForExist();
  expect(await $$('.azhen-photo-choice .checkbox-container.is-enabled').length).toBe(0);expect(await $('button=确认上传').isEnabled()).toBe(false);
  await $('button=取消').click();await browser.waitUntil(async()=>!await $('.azhen-photo-approval').isExisting());
  expect((await state()).calls).toHaveLength(0);await closeReceipt();
 });
 it('only uploads the selected photo and appends stable reference without changing original text',async function(){
  await $('.azhen-photo-save').click();await $('.azhen-photo-approval').waitForExist();
  await selectFirstPhoto();await $('button=确认上传').click();await $('.azhen-photo-references').waitForExist();
  expect((await state()).uploads).toBe(1);expect(await $('.azhen-photo-references').getValue()).toBe(`![照片](azhen-photo://v1/${id})`);
  await $('input[placeholder="日记/2026-11-24.md"]').setValue(note);await $('button=插入本地笔记').click();
  await browser.waitUntil(async()=> (await $('[role=status]').getText()).includes('插入成功'));
  const text=await browser.executeObsidian(async({app})=>app.vault.read(app.vault.getFileByPath('E2E-private-photo.md')!));expect(text).toBe(`---\ntitle: diary\n---\n正文保留\n\n![照片](azhen-photo://v1/${id})\n`);
  await $('button=插入本地笔记').click();
  const again=await browser.executeObsidian(async({app})=>app.vault.read(app.vault.getFileByPath('E2E-private-photo.md')!));expect(again).toBe(text);await closeReceipt();
 });
 it('preserves confirmed state across rerender and never uploads again for the same source',async function(){
  await browser.executeObsidian(({app})=>{const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0]!.view as any;v.renderTranscript(v.service.getMessages());});
  await $('.azhen-photo-save').click();await $('.azhen-photo-approval').waitForExist();await selectFirstPhoto();await $('button=确认上传').click();await $('.azhen-photo-references').waitForExist();expect((await state()).uploads).toBe(1);await closeReceipt();
 });
 it('renders repeated references through native Reading View and existing chat Markdown renderer',async function(){
  await browser.executeObsidian(async({app})=>{
   const p=(app as any).plugins.plugins['agentic-chat'];p.photos.cache.clear();
   const leaf=app.workspace.getLeaf(true);await leaf.openFile(app.vault.getFileByPath('E2E-private-photo.md')!,{state:{mode:'preview'}});(window as any).__PHOTO_E2E__.noteLeaf=leaf;
  });
  await $('.markdown-reading-view .azhen-photo-image').waitForExist();
  expect(await $('.markdown-reading-view .azhen-photo-image').getAttribute('src')).toContain('blob:');
  await browser.executeObsidian(async({app})=>{
   const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0]!.view as any;const b=v.newBubble();await b.finalizeText('图文查询结果\n\n![一](azhen-photo://v1/11111111-1111-4111-8111-111111111111)\n\n![二](azhen-photo://v1/11111111-1111-4111-8111-111111111111)',app,v);
  });
  await browser.waitUntil(async()=>await $$('.agentic-chat-messages .azhen-photo-image').length===2);
  expect((await state()).calls.filter((c:any)=>c.route==='read-authorizations')).toHaveLength(1);
 });
 it('keeps offline notes readable with retry and releases rendered resources',async function(){
  await browser.executeObsidian(async({app})=>{const p=(app as any).plugins.plugins['agentic-chat'];p.photos.cache.clear();(window as any).__PHOTO_E2E__.offline=true;const leaf=(window as any).__PHOTO_E2E__.noteLeaf;await app.workspace.revealLeaf(leaf);await leaf.setViewState({type:'markdown',state:{file:'E2E-private-photo.md',mode:'source',source:true}});await leaf.setViewState({type:'markdown',state:{file:'E2E-private-photo.md',mode:'preview'}});});
  await $('.markdown-reading-view .azhen-photo button').waitForExist();expect(await $('.markdown-reading-view').getText()).toContain('正文保留');
  const count=(await state()).calls.length;
  await browser.execute(()=>{(window as any).__PHOTO_E2E__.offline=false;});await $('.markdown-reading-view .azhen-photo button').click();await $('.markdown-reading-view .azhen-photo-image').waitForExist();expect((await state()).calls.length).toBeGreaterThan(count);
  const views=await browser.executeObsidian(async({app})=>{
   const h=(window as any).__PHOTO_E2E__;const leaf=h.noteLeaf;
   await leaf.setViewState({type:'markdown',state:{file:'E2E-private-photo.md',mode:'source',source:true}});
   const source=leaf.view.editor.getValue();
   await leaf.setViewState({type:'markdown',state:{file:'E2E-private-photo.md',mode:'source',source:false}});
   const live=leaf.view.getMode();
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   const nativeView=(leaf.view.containerEl as HTMLElement).querySelector<HTMLElement>('.markdown-source-view')!;
   const liveMetrics={enabled:nativeView.classList.contains('is-live-preview'),customImages:nativeView.querySelectorAll('img[src^="azhen-photo://"]').length,renderedPhotos:nativeView.querySelectorAll('.azhen-photo-image').length,editorContainsReference:nativeView.textContent?.includes('azhen-photo://v1/')??false};
   const p=(app as any).plugins.plugins['agentic-chat'];p.photos.cache.clear();
   return {source,live,liveMetrics,images:document.querySelectorAll('.azhen-photo-image').length,bytes:p.photos.cache.byteSize};
  });
  writeFileSync(`logs/photo-view-matrix-${process.env.AGENTIC_CHAT_E2E_MOBILE_VIEWPORT?'mobile':'desktop'}.json`,JSON.stringify({reading:true,chat:true,sourcePreserved:views.source.includes('azhen-photo://v1/'),live:views.liveMetrics},null,2));
  expect(views.source).toContain('azhen-photo://v1/');expect(views.live).toBe('source');expect(views.images).toBe(0);expect(views.bytes).toBe(0);
 });
 it('keeps AI photo requests behind explicit approval in YOLO and returns only stable refs',async function(){
  await browser.executeObsidianCommand('agentic-chat:open-chat');
  await browser.execute(()=>{
   (window as any).__AGENTIC_CHAT_E2E_TURNS__.push({content:[{type:'toolCall',id:'photo-save-tool',name:'save_photos',arguments:{purpose:'将已选照片用于日记',target:'E2E-private-photo.md'}}],stopReason:'toolUse'},{content:[{type:'text',text:'已获取稳定照片引用，正文继续保存在本地。'}],stopReason:'stop'});
  });
  await $('.agentic-chat-input').setValue('请保存刚才的照片并用于本地日记');await $('.agentic-chat-send').click();
  await $('.azhen-photo-approval').waitForExist();expect(await $$('.azhen-photo-choice .checkbox-container.is-enabled').length).toBe(0);
  await selectFirstPhoto();await $('button=确认上传').click();
  await browser.waitUntil(async()=> (await $('.agentic-chat-messages').getText()).includes('已获取稳定照片引用'));
  const result=await browser.executeObsidian(({app})=>{
   const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0]!.view as any;
   const tool=v.service.getMessages().find((m:any)=>m.role==='toolResult'&&m.toolName==='save_photos');
   return {text:JSON.stringify(tool?.content),toolNames:(window as any).__AGENTIC_CHAT_E2E_CALL_LOG__.at(-1).toolNames};
  });
  expect(result.text).toContain('azhen-photo://v1/');expect(result.text).not.toContain(png);expect(result.toolNames).toContain('save_photos');expect(result.toolNames.some((n:string)=>n.startsWith('mcp__azhen'))).toBe(false);const final=await browser.execute(() => ({uploads:(window as any).__PHOTO_E2E__.uploads,sources:(window as any).__PHOTO_E2E__.sources}));expect(final).toMatchObject({uploads:1});
 });
 it('cancels a pending direct request on chat tab switch without any cloud request',async function(){
  const count=(await state()).calls.length;
  await $('.azhen-photo-save').click();await $('.azhen-photo-approval').waitForExist();
  await browser.executeObsidian(({app})=>{const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0]!.view as any;(v.containerEl as HTMLElement).querySelector<HTMLButtonElement>('.agentic-chat-tab-add')!.click();});
  await browser.waitUntil(async()=>!await $('.azhen-photo-approval').isExisting());expect((await state()).calls.length).toBe(count);
  await browser.executeObsidian(({app})=>{const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0]!.view as any;(v.containerEl as HTMLElement).querySelector<HTMLButtonElement>('.agentic-chat-tab')!.click();});
 });
 it('exposes supported secret settings and blocks mode switch while approval is pending',async function(){
  await browser.executeObsidianCommand('agentic-chat:open-chat');
  await openAgenticChatSettings();await selectSettingsTab('Agent');expect(await $('body').getText()).toContain('COS 按需照片');expect(await $('body').getText()).toContain('SecretStorage');await closeAgenticChatSettings();
  await $('.azhen-photo-save').click();await $('.azhen-photo-approval').waitForExist();
  const result=await browser.executeObsidian(async({app})=>{const p=(app as any).plugins.plugins['agentic-chat'];return {changed:await p.requestKnowledgeModeChange('cloud'),mode:p.settings.knowledgeMode};});expect(result).toEqual({changed:false,mode:'local'});
  await $('button=取消').click();await closeReceipt();
 });
});
