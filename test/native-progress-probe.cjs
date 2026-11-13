// Isolated Obsidian assertions; no model or production records involved.
module.exports=async function(app,plugin,o,financeFixture,thirdPartyCss){
 const {Component,MarkdownRenderer}=o,results=[];
 const assert=(x,m)=>{if(!x)throw Error(m);};
 const wait=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>10000)throw Error('native progress wait timed out');await new Promise(r=>setTimeout(r,50));}};
 const root=document.body.createDiv();root.style.width='260px';const component=new Component();component.load();
 const render=async source=>{root.empty();await MarkdownRenderer.render(app,'```agentic-progress\n'+source+'\n```',root,'',component);};
 try{
  for(const [current,total,percent,fill] of [[8,12,66.7,66.7],[6,10,60,60],[0,10,0,0],[10,10,100,100],[12,10,120,100]]){
   await render(`label: 训练\ncurrent: ${current}\ntotal: ${total}\nunit: 天`);const p=root.querySelector('progress');assert(p,'native progress absent');assert(p.max===100&&p.value===fill,'wrong fill');assert(root.textContent.includes(`${current} / ${total} 天 · ${percent}%`),'wrong summary');
  }
  results.push({name:'all five deterministic values match native graphic and summary',passed:true});
  for(const source of ['current: 8\ntotal: 0','current: -1\ntotal: 10','current: 8','current: wrong\ntotal: 10','current: 8\ntotal: 10\npercent: 999','label: [bad]\ncurrent: 1\ntotal: 2']){await render(source);assert(!root.querySelector('progress'),'invalid value rendered');assert(root.textContent.includes('无法显示进度'),'missing fallback');}
  await render('label: "<img src=x onerror=alert(1)>"\ncurrent: 8\ntotal: 12\nunit: "<script>"');assert(root.querySelector('progress'),'text label rejected');assert(!root.querySelector('img,script'),'label interpreted as markup');
  results.push({name:'invalid data falls back and markup-looking labels remain text',passed:true});
  const original=document.body.className,style=document.createElement('style');
  const themes=[];try{for(const theme of ['light','dark','Blue Topaz']){document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(theme==='light'?'theme-light':'theme-dark');if(theme==='Blue Topaz'){style.textContent=thirdPartyCss;document.head.appendChild(style);}await render('current: 8\ntotal: 12\nunit: 天');const p=root.querySelector('progress');assert(root.scrollWidth<=root.clientWidth+1,'narrow overflow');assert(getComputedStyle(p).accentColor!=='auto','missing accent');assert(getComputedStyle(root.querySelector('.agentic-progress')).color!==getComputedStyle(root.querySelector('.agentic-progress')).backgroundColor,'contrast');themes.push({theme,accent:getComputedStyle(p).accentColor,width:p.getBoundingClientRect().width});}}finally{style.remove();document.body.className=original;}
  results.push({name:'260px light dark and Blue Topaz follow live theme',passed:true,themes});
  root.empty();await MarkdownRenderer.render(app,financeFixture.details.markdown,root,'',component);await wait(()=>root.querySelector('canvas'));assert(root.textContent.includes('支出 0.30 CNY'),'finance prose absent');assert(financeFixture.details.fact.coverage==='complete','partial fixture');results.push({name:'original complete-coverage finance prose and advanced-chart render together',passed:true,canvasCount:root.querySelectorAll('canvas').length});
  await plugin.openShortcut({requestId:crypto.randomUUID(),message:''});let view=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0].view;const service=view.activeTab.service,path=service.getSessionInfo().path;
  const code='```agentic-progress\nlabel: 历史进度\ncurrent: 8\ntotal: 12\nunit: 天\n```';const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  await service.sessions.rewriteMessages([{role:'user',content:'Native history fixture',timestamp:Date.now()},{role:'assistant',content:[{type:'text',text:code}],api:'openai-completions',provider:'fixture',model:'fixture',usage,stopReason:'stop',timestamp:Date.now()}]);
  await view.loadSession(path);await wait(()=>view.containerEl.querySelector('progress'));
  app.workspace.getLeavesOfType('agentic-chat-chat-view')[0].detach();await plugin.activateView();view=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0].view;await view.loadSession(path);await wait(()=>view.containerEl.querySelector('progress'));
  assert(view.containerEl.querySelector('progress').value===66.7,'history fill differs');assert(view.containerEl.textContent.includes('8 / 12 天 · 66.7%'),'history label differs');
  results.push({name:'native JSONL history close reopen restores graphical progress',passed:true});
 }finally{component.unload();root.remove();}
 return results;
};
