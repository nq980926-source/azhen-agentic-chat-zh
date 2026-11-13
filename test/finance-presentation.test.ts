import {it,expect} from "vitest";
import {completeFinanceFixture} from "./helpers/complete-finance-fixture";
import type {App} from "obsidian";
it("keeps full-coverage amounts, categories, period and units identical in original tool prose and chart",async()=>{
 const app={plugins:{enabledPlugins:new Set(["obsidian-charts"]),plugins:{"obsidian-charts":{}}}} as unknown as App;
 const result=await completeFinanceFixture(app);
 expect(result.isError).not.toBe(true);
 const d=result.details as {fact:{coverage:string;expense:string;income:string;from:string;to:string;unit:string;purposes:Array<{purpose:string;amount:string}>};markdown:string};
 expect(d.fact).toMatchObject({coverage:"complete",expense:"30",income:"10000",from:"2026-11-01",to:"2026-11-30",unit:"CNY"});
 const chart=JSON.parse(/```advanced-chart\n([\s\S]*?)\n```/.exec(d.markdown)![1]);
 expect(chart.data.labels).toEqual(d.fact.purposes.map(x=>x.purpose));
 expect(chart.data.datasets[0].data).toEqual(d.fact.purposes.map(x=>Number(x.amount)/100));
 expect(chart.data.datasets[0].data.reduce((sum:number,n:number)=>sum+Math.round(n*100),0)).toBe(Number(d.fact.expense));
 expect(d.markdown).toContain("支出 0.30 CNY");expect(d.markdown).toContain("收入 100.00 CNY");
 expect(d.markdown).toContain(d.fact.from);expect(d.markdown).toContain(d.fact.to);
 expect((result.content[0] as {text:string}).text).toBe(d.markdown);
});
