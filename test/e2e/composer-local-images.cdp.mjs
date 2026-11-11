const pages=await (await fetch('http://127.0.0.1:9238/json/list')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const expression=`(async()=>{
const results=[];const check=(name,ok)=>{results.push({name,ok});if(!ok)throw Error(name)};
const v=app.workspace.getLeavesOfType('agentic-chat-chat-view')[0].view;
const input=document.querySelector('.agentic-chat-input');let submitted=0;const original=v.submit;v.submit=async()=>{submitted++};
try{for(const [name,opts,count] of [['desktop Enter',{key:'Enter'},1],['Shift Enter',{key:'Enter',shiftKey:true},1],['IME Enter',{key:'Enter',isComposing:true},1]]){input.dispatchEvent(new KeyboardEvent('keydown',{...opts,bubbles:true,cancelable:true}));check(name,submitted===count)}}finally{v.submit=original}
const picker=document.querySelector('input[type=file]');check('picker accepts images and multiple',picker.multiple&&picker.accept.includes('image/png'));
const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const file=new File([bytes],'sample.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(file);picker.files=dt.files;picker.dispatchEvent(new Event('change'));
for(let i=0;i<40&&!document.querySelector('.agentic-chat-local-image');i++)await new Promise(r=>setTimeout(r,50));
check('thumbnail',document.querySelectorAll('.agentic-chat-local-image').length===1);
picker.files=dt.files;picker.dispatchEvent(new Event('change'));for(let i=0;i<40&&v.imageReads;i++)await new Promise(r=>setTimeout(r,50));check('dedup',document.querySelectorAll('.agentic-chat-local-image').length===1);
document.querySelector('.agentic-chat-local-image button').click();check('remove',document.querySelectorAll('.agentic-chat-local-image').length===0);
return {mode:'real Obsidian desktop, synthetic File selection',results};})()`;
const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});console.log(JSON.stringify(result));(await import('node:fs')).writeFileSync('logs/composer-ui/results.json',JSON.stringify(result,null,2));ws.close();if(result.result?.exceptionDetails)process.exitCode=1;
