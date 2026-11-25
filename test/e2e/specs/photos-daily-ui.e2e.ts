/* eslint-disable @typescript-eslint/no-explicit-any -- Actual isolated Obsidian API inspection, no simulated COS. */
import { browser, expect, $ } from '@wdio/globals';
import { describe,it,after } from 'mocha';
import { openAgenticChatSettings,selectSettingsTab,closeAgenticChatSettings } from '../support/settings-ui';

describe('daily photo UI without cloud requests',function(){
 this.timeout(90000);
 it('registers the note command and refuses unpaired uploads without changing note text',async()=>{
  const result=await browser.executeObsidian(async({app})=>{
   const p=(app as any).plugins.plugins['agentic-chat'];p.settings.knowledgeMode='local';p.settings.mode='ask';p.settings.photos.enabled=false;
   let file=app.vault.getFileByPath('E2E-daily-photo-ui.md');
   if(!file)file=await app.vault.create('E2E-daily-photo-ui.md','original text\n');
   await app.workspace.getLeaf().openFile(file as any);
   const command=(app as any).commands.commands['agentic-chat:save-note-photos'];
   const available=command.checkCallback(true);command.checkCallback(false);
   return {available,text:await app.vault.read(file as any),origin:window.origin};
  });
  expect(result.available).toBe(true);expect(result.text).toBe('original text\n');
  console.warn('WINDOWS_PHOTO_ORIGIN='+result.origin);
 });
 it('shows one-time device pairing and the complete original-photo limits in actual settings',async()=>{
  await openAgenticChatSettings();await selectSettingsTab('Agent');
  const text=await $('.vertical-tab-content').getText();
  expect(text).toContain('每张最多 10 MiB');expect(text).toContain('合计最多 40 MiB');
  expect(text).toContain('一次性配对码');expect(text).toContain('连接此设备');
  const input=await browser.$('input[type="password"]');expect(await input.getAttribute('autocomplete')).toBe('off');
  await closeAgenticChatSettings();
 });
 it('uses the same photo renderer in native Live Preview and Reading View without changing source',async()=>{
  await browser.executeObsidian(async({app})=>{
   const file=app.vault.getFileByPath('E2E-daily-photo-ui.md') as any;
   await app.vault.modify(file,'original text\n\n![photo](azhen-photo://v1/11111111-1111-4111-8111-111111111111)\n\nafter\n');
   const leaf=app.workspace.getMostRecentLeaf()!;await leaf.openFile(file);
   await (leaf.view as any).setState({mode:'source',source:false},{history:false});
   (leaf.view as any).editor.setCursor({line:0,ch:0});
  });
  await browser.waitUntil(async()=>await browser.executeObsidian(({app})=>!!app.workspace.getMostRecentLeaf()?.view.containerEl.querySelector('.markdown-source-view.is-live-preview .azhen-photo-editor')),{timeout:10000});
  const before=await browser.executeObsidian(async({app})=>{
   const file=app.vault.getFileByPath('E2E-daily-photo-ui.md') as any;
   const leaf=app.workspace.getMostRecentLeaf()!;await (leaf.view as any).setState({mode:'preview'},{history:false});
   return app.vault.read(file);
  });
  await browser.waitUntil(async()=>await browser.executeObsidian(({app})=>!!app.workspace.getMostRecentLeaf()?.view.containerEl.querySelector('.markdown-reading-view .azhen-photo')),{timeout:10000});
  expect(before).toContain('azhen-photo://v1/11111111-1111-4111-8111-111111111111');
  expect(before).not.toContain('q-signature');
 });
 it('keeps references editable in Source Mode and does not render fenced examples in Live Preview',async()=>{
  await browser.executeObsidian(async({app})=>{
   const leaf=app.workspace.getMostRecentLeaf()!;
   await (leaf.view as any).setState({mode:'source',source:true},{history:false});
  });
  await browser.waitUntil(async()=>await browser.executeObsidian(({app})=>app.workspace.getMostRecentLeaf()?.view.containerEl.querySelectorAll('.azhen-photo-editor').length===0));
  await browser.executeObsidian(async({app})=>{
   const file=app.vault.getFileByPath('E2E-daily-photo-ui.md') as any;
   await app.vault.modify(file,'before\n\n```markdown\n![example](azhen-photo://v1/11111111-1111-4111-8111-111111111111)\n```\n\nafter\n');
   const leaf=app.workspace.getMostRecentLeaf()!;await (leaf.view as any).setState({mode:'source',source:false},{history:false});
   (leaf.view as any).editor.setCursor({line:0,ch:0});
  });
  expect(await browser.executeObsidian(({app})=>app.workspace.getMostRecentLeaf()?.view.containerEl.querySelectorAll('.azhen-photo-editor').length)).toBe(0);
 });
 after(async()=>{
  await browser.executeObsidian(async({app})=>{const f=app.vault.getFileByPath('E2E-daily-photo-ui.md');if(f)await app.fileManager.trashFile(f);});
 });
});
