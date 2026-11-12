import {describe,it,expect,vi} from "vitest";
import AgenticChatPlugin from "../src/main";
import type {NativeShortcutResult} from "../src/ui/chat-view";
describe('native shortcut request identity',()=>{
 it('keeps an accepted request idempotent throughout the plugin lifetime',async()=>{
  let count=0;const launch=vi.fn(async()=>({sessionId:String(++count),status:'opened' as const}));
  const gateway=Object.assign(Object.create(AgenticChatPlugin.prototype),{shortcutRequests:new Map<string,Promise<NativeShortcutResult>>(),launchShortcut:launch}) as {openShortcut(request:{requestId:string;message:string}):Promise<NativeShortcutResult>};
  const first=await gateway.openShortcut({requestId:'first',message:''});
  for(let i=0;i<70;i++)await gateway.openShortcut({requestId:'later-'+i,message:''});
  expect(await gateway.openShortcut({requestId:'first',message:''})).toEqual(first);expect(launch).toHaveBeenCalledTimes(71);
 });
 it('a rejected request is not automatically re-executed',async()=>{
  const launch=vi.fn(async()=>{throw Error('creation failed');});
  const gateway=Object.assign(Object.create(AgenticChatPlugin.prototype),{shortcutRequests:new Map<string,Promise<NativeShortcutResult>>(),launchShortcut:launch}) as {openShortcut(request:{requestId:string;message:string}):Promise<NativeShortcutResult>};
  for(let i=0;i<2;i++)await expect(gateway.openShortcut({requestId:'same',message:'x'})).rejects.toThrow('creation failed');expect(launch).toHaveBeenCalledOnce();
 });
});
