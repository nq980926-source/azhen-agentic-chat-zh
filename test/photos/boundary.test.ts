import { describe, it, expect, vi } from 'vitest';
import { PhotoClient, PhotoError, validateObjectGrant, DEFAULT_PHOTOS } from '../../src/photos/client';
import { PhotoTasks } from '../../src/photos/tasks';
describe('approved private photo boundary', () => {
 it('rejects a grant outside the exact private bucket prefix',()=>{
  expect(()=>validateObjectGrant({method:'GET',url:'https://attacker.invalid/a',expiresAt:200,serverTime:100},'GET','11111111-1111-4111-8111-111111111111',DEFAULT_PHOTOS)).toThrow();
 });
 it('cancel performs no authorization or transfer',async()=>{
  const wire=vi.fn();const client=new PhotoClient(()=>({...DEFAULT_PHOTOS,enabled:true}),()=> 'synthetic-token-for-local-tests-only',wire);
  const tasks=new PhotoTasks(client,{load:()=>[],save:()=>{}},()=>true);
  const result=await tasks.save({key:'session:1',images:[{name:'one.png',data:'iVBORw0KGgo=',mimeType:'image/png',size:8}]},async()=>null);
  expect(result).toEqual([]); expect(wire).not.toHaveBeenCalled();
 });
});
