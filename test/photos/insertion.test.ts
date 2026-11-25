import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Platform, type App } from 'obsidian';
import { PhotoRuntime } from '../../src/photos/runtime';
import { FakeApp } from '../helpers/fake-vault';
const originalMobile=Platform.isMobile;
beforeEach(()=>{Platform.isMobile=true;});afterEach(()=>{Platform.isMobile=originalMobile;});
const reference='![照片](azhen-photo://v1/11111111-1111-4111-8111-111111111111)';
async function fixture(){
 const app=new FakeApp();
 Object.assign(app.vault,{configDir:'.obsidian',read:(file:{path:string})=>app.vault.adapter.read(file.path),getFileByPath:(path:string)=>app.vault.getAbstractFileByPath(path)});
 await app.vault.create('note.md','---\ntitle: original\n---\nbody\n');
 const runtime={plugin:{app:app as unknown as App,settings:{ignoredGlobs:''}},permitted:()=>true} as unknown as PhotoRuntime;
 return {app,insert:(path='note.md')=>PhotoRuntime.prototype.insert.call(runtime,path,reference)};
}
describe('photo insertion with original Vault tools',()=>{
 it('appends once without changing existing text or frontmatter',async()=>{
  const {app,insert}=await fixture();await insert();expect(await app.vault.adapter.read('note.md')).toBe('---\ntitle: original\n---\nbody\n\n'+reference+'\n');await insert();expect((await app.vault.adapter.read('note.md')).split('azhen-photo://').length).toBe(2);
 });
 it('detects an external change during the atomic edit and preserves it',async()=>{
  const {app,insert}=await fixture();const process=app.vault.process.bind(app.vault);app.vault.process=async(file,fn)=>{await app.vault.modify(file,'external Syncthing update');return process(file,fn);};await expect(insert()).rejects.toThrow('changed');expect(await app.vault.adapter.read('note.md')).toBe('external Syncthing update');
 });
 it.each(['../note.md','C:/note.md','/note.md','.obsidian/config.md','.git/config.md','.trash/note.md','missing.md'])('refuses unsafe or missing target %s',async(path)=>{const {insert}=await fixture();await expect(insert(path)).rejects.toThrow();});
 it('preserves text and reports failure when storage fails',async()=>{const {app,insert}=await fixture();app.vault.process=async()=>{throw new Error('storage failed');};await expect(insert()).rejects.toThrow('storage failed');expect(await app.vault.adapter.read('note.md')).toContain('body');});
 it('uses the same browser-safe path on emulated mobile',async()=>{
  const mobile=Platform.isMobile;Platform.isMobile=true;
  try{const {app,insert}=await fixture();await insert();expect(await app.vault.adapter.read('note.md')).toContain(reference);}finally{Platform.isMobile=mobile;}
 });
});
