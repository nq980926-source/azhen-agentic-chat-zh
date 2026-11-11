import { describe, expect, it, vi } from "vitest";
import { createWebTools } from "../src/tools/web-tools";
import type { ToolArtifactStoreLike, ToolArtifactWriteInput } from "../src/artifacts/tool-artifact-store";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings";
import type { WebFetcher, WebHttpRequest } from "../src/tools/web-fetch";
import { hydrateSettingsSecrets, MemorySecretStore, settingsForStorage, switchWebSearchProvider } from "../src/secrets/secret-store";

function fixture(body: unknown = {results:[]}, status = 200) {
 const requests: WebHttpRequest[] = [];
 const fetcher: WebFetcher = async request => { requests.push(request); return {status,headers:{},text: typeof body === "string" ? body : JSON.stringify(body)}; };
 const tools = createWebTools({...DEFAULT_SETTINGS.web,enabled:true,searchProvider:"deepseek",searchApiKey:"fixture-search-only"},fetcher);
 return {requests, search: (query="测试", maxResults=5) => tools[0]!.execute("test",{query,maxResults}), fetch: (url="https://example.com/article",offset=0) => tools[1]!.execute("test",{url,offset,maxChars:500})};
}

describe("DeepSeek web backend", () => {
 it("sends only the minimal search fields and preserves sources",async()=>{
  const f=fixture({results:[{title:"标题",url:"https://example.com",summary:"长摘要",snippet:"短摘要"},{title:"第二项",url:"https://example.org",snippet:"回退"}]});
  const result=await f.search();
  expect(f.requests[0]).toEqual({url:"https://api.deepseek.com/v1/tools/search",method:"POST",headers:{Authorization:"Bearer fixture-search-only","Content-Type":"application/json"},body:JSON.stringify({query:"测试",count:5,need_content:false})});
  expect(JSON.stringify(result)).toContain("长摘要"); expect(JSON.stringify(result)).toContain("回退"); expect(JSON.stringify(result)).toContain("https://example.com");
 });
 it("allows empty results",async()=>{expect(JSON.stringify(await fixture().search())).toContain("No web results");});
 it.each(["not-json",{}, {results:null},{results:[{}]}])("rejects invalid search response %j",async body=>{await expect(fixture(body).search()).rejects.toThrow(/invalid/i);});
 it("counts Unicode code points and retains the ten-result ceiling",async()=>{
  const f=fixture(); await f.search("😀".repeat(128),50); expect(JSON.parse(f.requests[0]!.body!).count).toBe(10);
  await expect(f.search("😀".repeat(129))).rejects.toThrow(/128/); await expect(f.search("  ")).rejects.toThrow(); expect(f.requests).toHaveLength(1);
 });
 it("returns Markdown with original URL, title and pagination",async()=>{
  const f=fixture({title:"Page",content:"# Heading\n"+"body ".repeat(200)});const result=await f.fetch();
  expect(f.requests[0]!.url).toBe("https://api.deepseek.com/v1/tools/fetch");expect(JSON.parse(f.requests[0]!.body!)).toEqual({url:"https://example.com/article"});
  expect(result.details).toMatchObject({url:"https://example.com/article",title:"Page",offset:0,nextOffset:500,hasMore:true});
  expect(JSON.stringify(result)).toContain("# Heading");expect(JSON.stringify(result)).not.toContain("api.deepseek.com");
  expect((await f.fetch(undefined,500)).details).toMatchObject({offset:500});
 });
 it.each(["http://127.0.0.1/a","http://192.168.1.1/a","file:///a","https://user:pass@example.com/a","https://example.com/"+"a".repeat(8192)])("blocks unsafe target before sending %s",async url=>{
  const f=fixture();await expect(f.fetch(url)).rejects.toThrow();expect(f.requests).toHaveLength(0);
 });
 it("enforces target host allowlist before contacting DeepSeek",async()=>{
  const fetcher=vi.fn<WebFetcher>();const tools=createWebTools({...DEFAULT_SETTINGS.web,enabled:true,searchProvider:"deepseek",searchApiKey:"fixture",allowedHosts:"allowed.example"},fetcher);
  await expect(tools[1]!.execute("t",{url:"https://other.example"})).rejects.toThrow(/allowlist/);expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([0,400,401,402,403,404,408,429,500,504])("reports HTTP %i without echoing sensitive bodies",async status=>{
  const f=fixture("fixture-sensitive-response",status);await expect(f.search()).rejects.toThrow(`HTTP ${status}`);await expect(f.fetch()).rejects.toThrow(`HTTP ${status}`);
  try{await f.search();}catch(error){expect(String(error)).not.toContain("fixture-sensitive-response");expect(String(error)).not.toContain("fixture-search-only");}
 });
 it.each(["not-json",null,{}, {title:"Page"}, {title:3,content:"text"}])("rejects invalid Fetch response %j",async body=>{await expect(fixture(body).fetch()).rejects.toThrow(/invalid/i);});
 it("requires dedicated search credentials and never reads chat keys",async()=>{
  const settings=mergeSettings({openaiCompatibleApiKey:"chat-fixture",web:{...DEFAULT_SETTINGS.web,enabled:true,searchProvider:"deepseek",searchApiKey:""}});
  const fetcher=vi.fn<WebFetcher>();const tools=createWebTools(settings.web,fetcher);await expect(tools[0]!.execute("t",{query:"test"})).rejects.toThrow(/key/);await expect(tools[1]!.execute("t",{url:"https://example.com"})).rejects.toThrow(/key/);expect(fetcher).not.toHaveBeenCalled();
 });
 it("stores provider keys separately across switching, serialization and reload",()=>{
  const store=new MemorySecretStore();const settings=mergeSettings({});settings.web.searchApiKey="tavily-fixture";
  switchWebSearchProvider(settings,"deepseek",store);expect(settings.web.searchApiKey).toBe("");settings.web.searchApiKey="deepseek-fixture";
  switchWebSearchProvider(settings,"brave",store);expect(settings.web.searchApiKey).toBe("");settings.web.searchApiKey="brave-fixture";
  switchWebSearchProvider(settings,"deepseek",store);expect(settings.web.searchApiKey).toBe("deepseek-fixture");
  const persisted=settingsForStorage(settings,store);expect(JSON.stringify(persisted)).not.toContain("-fixture");
  const reloaded=mergeSettings(persisted);hydrateSettingsSecrets(reloaded,store);expect(reloaded.web.searchApiKey).toBe("deepseek-fixture");
  switchWebSearchProvider(reloaded,"tavily",store);expect(reloaded.web.searchApiKey).toBe("tavily-fixture");switchWebSearchProvider(reloaded,"brave",store);expect(reloaded.web.searchApiKey).toBe("brave-fixture");
 });
 it("sanitizes thrown transport errors and preserves cancellation",async()=>{
  const fetcher: WebFetcher=async()=>{throw new Error("fixture-secret-header");};
  const tools=createWebTools({...DEFAULT_SETTINGS.web,enabled:true,searchProvider:"deepseek",searchApiKey:"fixture"},fetcher);
  for(const [index,params] of [[0,{query:"test"}],[1,{url:"https://example.com"}]] as const){
   await expect(tools[index]!.execute("t",params)).rejects.toThrow("connection failed or timed out");
   const abort=new AbortController();abort.abort();await expect(tools[index]!.execute("t",params,abort.signal)).rejects.toThrow(/abort/i);
  }
 });
 it("stores source artifacts under the target URL",async()=>{
  let written: ToolArtifactWriteInput | undefined;
  const store: ToolArtifactStoreLike={writeArtifact:async input=>{written=input;return {id:"fixture-artifact",label:input.label,sourceToolName:input.sourceToolName,contentType:"text/markdown",createdAt:"2026-11-12",charLength:input.text.length};},readArtifact:async()=>{throw new Error("unused");}};
  const tools=createWebTools({...DEFAULT_SETTINGS.web,enabled:true,searchProvider:"deepseek",searchApiKey:"fixture"},async()=>({status:200,headers:{},text:JSON.stringify({title:"Official page",content:"# Markdown body"})}),store);
  const result=await tools[1]!.execute("t",{url:"https://example.com/source"});
  expect(written).toMatchObject({sourceUrl:"https://example.com/source"});expect(written?.text).toContain("# Markdown body");expect(result.details).toMatchObject({sourceArtifactId:"fixture-artifact",url:"https://example.com/source"});
 });
 it("does not register tools when disabled",()=>{expect(createWebTools({...DEFAULT_SETTINGS.web,searchProvider:"deepseek",enabled:false},vi.fn())).toEqual([]);});
});
