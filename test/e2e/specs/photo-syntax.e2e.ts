import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
describe('photo syntax compatibility', function () {
 it('checks native Markdown image protocol without network', async function () {
  const result=await browser.executeObsidian(async ({ app, obsidian })=>{
   const container=document.createElement('div');document.body.append(container);
   const owner=new obsidian.Component();owner.load();
   try {
    await obsidian.MarkdownRenderer.render(app,'before\n\n![example](azhen-photo://v1/11111111-1111-4111-8111-111111111111)\n\nafter',container,'',owner);
    return {html:container.innerHTML, images:container.querySelectorAll('img').length, text:container.textContent};
   } finally {owner.unload();container.remove();}
  });
  console.log('PHOTO_NATIVE_MARKDOWN',JSON.stringify(result));
  expect(result.text).toContain('before'); expect(result.text).toContain('after');
 });
});
