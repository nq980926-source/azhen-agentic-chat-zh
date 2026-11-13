// Same synthetic full-coverage ledger used by azhen-finance-tools.test.ts.
// No personal accounts, network requests or mutable business records.
import type {App} from "obsidian";
import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {AgenticChatSettings} from "../../src/settings";
import {createAzhenFinanceTools} from "../../src/tools/azhen-finance-tools";
import {sha256Hex} from "../../src/finance/azhen-finance";
export const FINANCE_FIXTURE_SERVER = "fixture-finance";
export const financeFixtureFiles: Record<string,string> = {
 "生活/记账/用户财务档案.md":"# 财务档案\n\n- 项目制已取消\n",
 "生活/记账/账本/2026-11.md":["# 2026年11月账本","","日期｜用途｜金额｜来源","2026-11-01｜早餐｜0.10｜每日额度","2026-11-01｜午餐｜0.20｜每日额度","2026-11-02｜工资｜100.00｜新增入账","2026-11-03｜还款｜50.00｜存款（还款）","2026-11-04｜回填｜30.00｜月度池→存款",""] .join("\n"),
};
export async function completeFinanceFixture(app:App) {
 const read={name:`mcp__${FINANCE_FIXTURE_SERVER}__read_file`,execute:async(_id:string,input:unknown)=>{
  const path=(input as {relative_path:string}).relative_path,content=financeFixtureFiles[path];
  const envelope=content===undefined?{status:"failed",error:"文件不存在"}:{status:"success",result:{content,sha256:await sha256Hex(content)}};
  return {content:[{type:"text",text:JSON.stringify(envelope)}],details:{structuredContent:envelope}};
 }} as unknown as AgentTool;
 const tool=createAzhenFinanceTools({app,getSettings:()=>({mcp:{enabled:true,servers:[{id:FINANCE_FIXTURE_SERVER,enabled:true,url:"https://106.55.92.40/mcp"}]},plugins:{mcpState:{}}} as unknown as AgenticChatSettings),getMcpTools:()=>[read],getTurnContext:()=>({messages:[{role:"user",content:[{type:"text",text:"本月的钱主要花在哪里？"}],timestamp:1}]})})[0];
 return tool.execute("complete-finance-fixture",{from:"2026-11-01",to:"2026-11-30",chart:"auto"});
}
