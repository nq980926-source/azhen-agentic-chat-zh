// Development-only assertions, run by an isolated Obsidian test plugin.
// Does not call a model, change user settings, or write business records.
module.exports=async function(app,plugin,{Component,MarkdownRenderer}){
 const results=[];const assert=(x,m)=>{if(!x)throw Error(m);};
 const wait=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>10000)throw Error('native render timed out');await new Promise(r=>setTimeout(r,50));}};
 const receipt=await plugin.openShortcut({requestId:crypto.randomUUID(),message:''});
 const view=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0].view;
 const service=view.activeTab.service;
 const compose=()=>service.runtimeResources.composeSystemPrompt(plugin.settings,service.getActiveModelId());
 let enabled=compose();assert(receipt.sessionId,'native session absent');
 assert(enabled.includes('Available Charts formats: chart YAML; advanced-chart JSON.'),'enabled formats absent');
 assert(enabled.startsWith(plugin.settings.systemPrompt.trim()),'custom prompt lost');
 await app.plugins.disablePlugin('obsidian-charts');
 assert(compose().includes('Charts rendering is unavailable or unconfirmed'),'disabled state stale');
 await app.plugins.enablePlugin('obsidian-charts');enabled=compose();
 assert(enabled.includes('Available Charts formats: chart YAML; advanced-chart JSON.'),'reenabled state stale');
 results.push({name:'native session preserves custom prompt and reflects Charts enable/disable/reenable',passed:true});
 for(const language of ['chart','advanced-chart']){
  const block=new RegExp('```'+language+'\\n([\\s\\S]*?)\\n```').exec(enabled);
  assert(block,'syntax example absent');const component=new Component();component.load();const el=document.body.createDiv();el.style.width='320px';
  try{await MarkdownRenderer.render(app,'```'+language+'\n'+block[1]+'\n```',el,'',component);await wait(()=>el.querySelector('canvas'));assert(el.querySelector('canvas').width>0,'empty canvas');results.push({name:language+' contract renders with installed Charts',passed:true,canvasCount:el.querySelectorAll('canvas').length});}
  finally{component.unload();el.remove();}
 }
 return results;
};
