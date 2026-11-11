import { describe,it,expect,afterEach } from "vitest";
import { buildModel, type ModelConfig } from "../src/llm/models";
import { agentSupportsImages } from "../src/agent/service-readouts";
import { clearPricingCacheForTests,seedPricingCacheForTests } from "../src/llm/pricing-cache";
const config=(baseUrl:string,modelId:string):ModelConfig=>({provider:"openai-compatible",modelId,openaiCompatibleBaseUrl:baseUrl,ollamaBaseUrl:"",privacy:{denyDataCollection:true,requireZDR:true,allowFallbacks:false}});
afterEach(clearPricingCacheForTests);
describe("endpoint-scoped vision capability",()=>{
 it.each([['https://api.deepseek.com','deepseek-flash'],['https://api.deepseek.com/v1','deepseek-flash'],['https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','deepseek-v4.1-flash'],['https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','deepseek-v4.1-flash-1017']])("enables documented pair %s %s without rewriting",(url,id)=>{const model=buildModel(config(url,id));expect(agentSupportsImages(model)).toBe(true);expect(model.id).toBe(id);expect(model.baseUrl).toBe(url)});
 it.each([['https://unknown.example/v1','deepseek-v4.1-flash'],['https://api.deepseek.com','deepseek-v4.1-flash'],['https://api.deepseek.com','deepseek-v4-pro'],['https://api.deepseek.com.evil.example','deepseek-flash'],['http://api.deepseek.com','deepseek-flash'],['https://token-plan.cn-beijing.maas.aliyuncs.com/other','deepseek-v4.1-flash']])("blocks unverified pair %s %s",(url,id)=>{expect(agentSupportsImages(buildModel(config(url,id)))).toBe(false)});
 it("uses OpenRouter image metadata only for OpenRouter",()=>{seedPricingCacheForTests({'deepseek/verified':{id:'deepseek/verified',n:'verified',c:100,m:100,pi:0,po:0,pr:0,pw:0,t:1,re:0,tlm:null,im:1}});expect(agentSupportsImages(buildModel({...config('', 'deepseek/verified'),provider:'openrouter'}))).toBe(true);expect(agentSupportsImages(buildModel(config('https://unknown.example','deepseek/verified')))).toBe(false)});
});

import { normalizeContext } from "@earendil-works/pi-ai";
import { streamOpenAICompatibleViaRequestUrl, type OpenAICompatibleRequest } from "../src/llm/openai-compatible-request";
it.each(["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017"])("serializes %s text + real image into one request",async(id)=>{
 const model=buildModel(config("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",id));
 let captured:OpenAICompatibleRequest|undefined;
 const stream=streamOpenAICompatibleViaRequestUrl(model,normalizeContext({messages:[{role:"user",content:[{type:"text",text:"描述图片"},{type:"image",mimeType:"image/png",data:"iVBORw0KGgo="}],timestamp:1}]}),{apiKey:"test-only"},async(request)=>{captured=request;return{status:200,text:"",json:{choices:[{message:{role:"assistant",content:"mock"},finish_reason:"stop"}]}}});
 for await(const event of stream){void event;}
 expect((await stream.result()).stopReason).not.toBe("error");
 expect(captured?.url).toBe(model.baseUrl+"/chat/completions");
 expect(JSON.parse(captured?.body??"{}")).toMatchObject({model:id,messages:[{role:"user",content:[{type:"text",text:"描述图片"},{type:"image_url",image_url:{url:"data:image/png;base64,iVBORw0KGgo="}}]}]});
});
