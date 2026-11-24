import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/settings';
describe('private photos feature witness',()=>{
 it('defaults to opt-in for new and upgraded local installations',()=>{
  expect(mergeSettings(null)).toMatchObject({knowledgeMode:'local',photos:{enabled:false}});
  expect(mergeSettings({knowledgeMode:'local'})).toMatchObject({knowledgeMode:'local',photos:{enabled:false}});
 });
});
