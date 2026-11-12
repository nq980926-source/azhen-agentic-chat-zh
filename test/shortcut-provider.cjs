// Loopback-only synthetic OpenAI-compatible provider for native acceptance.
const http=require('node:http');
let requests=0;
http.createServer((req,res)=>{
  let body='';req.on('data',b=>body+=b);req.on('end',()=>{
    if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'shortcut-fixture'}],requests}));return;}
    requests++;let q;try{q=JSON.parse(body);}catch{res.writeHead(400);res.end();return;}
    const users=(q.messages||[]).filter(m=>m.role==='user'),last=users.at(-1)?.content;
    const text=typeof last==='string'?last:JSON.stringify(last);
    const ask=text.includes('ask-native')&&!(q.messages||[]).some(m=>m.role==='tool');
    const delta=ask?{role:'assistant',tool_calls:[{index:0,id:'ask-fixture',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'Native follow-up?',choices:['继续']})}}]}:{role:'assistant',content:'fixture response'};
    const send=()=>{if(res.destroyed)return;if(q.stream!==true){const message=ask?{role:'assistant',tool_calls:delta.tool_calls.map(({index,...call})=>call)}:delta;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'fixture-'+requests,object:'chat.completion',created:1,model:'shortcut-fixture',choices:[{index:0,message,finish_reason:ask?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return;}res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});const chunk=(delta,finish_reason=null)=>({id:'fixture-'+requests,object:'chat.completion.chunk',created:1,model:'shortcut-fixture',choices:[{index:0,delta,finish_reason}]});res.write('data: '+JSON.stringify(chunk(delta))+'\n\n');res.write('data: '+JSON.stringify(chunk({},ask?'tool_calls':'stop'))+'\n\n');res.end('data: [DONE]\n\n');};
    if(text.includes('hold-native'))setTimeout(send,20000);else send();
  });
}).listen(19515,'127.0.0.1',()=>console.log('synthetic provider listening on loopback 19515'));
