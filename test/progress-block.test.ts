import {describe,it,expect} from "vitest";
import {parseProgressData} from "../src/ui/progress-block";

describe("native progress values",()=>{
 it.each([[8,12,66.7,66.7],[6,10,60,60],[0,10,0,0],[10,10,100,100],[12,10,120,100]])("calculates %s/%s once for label and fill",(current,total,percent,fill)=>{
   expect(parseProgressData({current,total,label:"训练",unit:"天"})).toEqual({current,total,label:"训练",unit:"天",percent,fill});
 });
 it.each([{},null,[],{current:1},{current:1,total:0},{current:1,total:-1},{current:-1,total:10},{current:"8",total:12},{current:NaN,total:10},{current:Infinity,total:10},{current:1,total:Infinity},{current:Number.MAX_VALUE,total:10},{current:1,total:1e-320},{current:1,total:10,percent:100},{current:1,total:10,label:{}},{current:1,total:10,unit:"x".repeat(41)}])("rejects invalid inputs without inventing a percentage",input=>{
   expect(parseProgressData(input)).toBeNull();
 });
 it("keeps labels as text data and defaults absent labels",()=>{
   expect(parseProgressData({current:0,total:10})?.label).toBe("进度");
   expect(parseProgressData({current:1,total:2,label:'<img src=x onerror=alert(1)>',unit:'<script>'})?.label).toContain("<img");
 });
});
