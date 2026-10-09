import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
type Row=Record<string,unknown>;
const state=vi.hoisted(()=>({actor:{userId:'00000000-0000-4000-8000-000000000001',email:'staff@example.invalid',displayName:'Staff',role:'admin'},writes:[] as Row[],audits:[] as unknown[][],rpcCalls:[] as {name:string;args:Row}[]}));
function query(table:string){const result={select:()=>result,order:()=>result,eq:()=>result,single:()=>result,update:(value:Row)=>{state.writes.push({table,...value});return result;},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(resolve({data:{id:'00000000-0000-4000-8000-000000000002',active:true},error:null}))};return result;}
vi.mock('../supabase/functions/_shared/supabase.ts',()=>({adminClient:()=>({from:query,rpc:async(name:string,args:Row)=>{state.rpcCalls.push({name,args});return {data:{rows:[],total:0},error:null};}}),userClient:()=>({}),requireStaff:async()=>state.actor}));
vi.mock('../supabase/functions/_shared/accounts.ts',()=>({requireAccount:async()=>({user:{id:state.actor.userId}}),appUrl:()=> 'https://example.invalid/'}));
vi.mock('../supabase/functions/_shared/audit.ts',()=>({writeAudit:async(...args:unknown[])=>{state.audits.push(args);}}));
let handler:(request:Request)=>Promise<Response>;
beforeAll(async()=>{vi.stubGlobal('Deno',{env:{get:()=>undefined},serve:(callback:typeof handler)=>{handler=callback;}});const path='../supabase/functions/admin-api/index.ts';await import(path);});
afterAll(()=>vi.unstubAllGlobals());beforeEach(()=>{state.actor.role='admin';state.rpcCalls.length=0;state.writes.length=0;state.audits.length=0;});
const id='00000000-0000-4000-8000-000000000002';
const invoke=(body:Row)=>handler(new Request('https://example.invalid/',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer token'},body:JSON.stringify(body)}));
describe('admin archival and review authorization',()=>{
 it('Admin cannot remove a closure by claiming Owner',async()=>{const response=await invoke({action:'schedule.closure-delete',closureId:id,role:'owner',reason:'A meaningful reason here'});expect(response.status).toBe(403);expect(state.writes).toEqual([]);});
 it('Owner archives a closure and records the reason',async()=>{state.actor.role='owner';const response=await invoke({action:'schedule.closure-delete',closureId:id,reason:'Holiday was rescheduled by Operations'});expect(response.status).toBe(200);expect(state.writes[0]?.active).toBe(false);expect(state.audits[0]?.[5]).toEqual({reason:'Holiday was rescheduled by Operations'});});
 it('Owner cannot archive without review evidence',async()=>{state.actor.role='owner';const response=await invoke({action:'schedule.closure-delete',closureId:id,reason:'short'});expect(response.status).toBe(400);expect(state.writes).toEqual([]);});
 it('Admin cannot hide a person through the save action',async()=>{const response=await invoke({action:'people.save',person:{id,active:false},role:'owner',archiveReason:'Forged authorization claim'});expect(response.status).toBe(403);expect(state.writes).toEqual([]);});
 it('an MS Ambassador cannot access another participant’s quiz review',async()=>{state.actor.role='ambassador';const response=await invoke({action:'quizzes.review',attemptId:id});expect(response.status).toBe(403);});
 it('an operational Admin can record a review without changing scores',async()=>{const response=await invoke({action:'quizzes.review-note',attemptId:id,note:'Arrange another supervised practical assessment'});expect(response.status).toBe(200);expect(state.writes).toEqual([]);expect(state.audits[0]?.[2]).toBe('training_result_reviewed');});
});

describe('admin attempt search',()=>{
 it('searches the retained history with the server actor and bounded page',async()=>{const response=await invoke({action:'quizzes.list',actor:id,search:'student@example.invalid',result:'passed',page:2});expect(response.status).toBe(200);expect(state.rpcCalls[0]).toEqual({name:'search_training_attempts',args:{p_actor:state.actor.userId,p_search:'student@example.invalid',p_result:'passed',p_page:2}});expect((await response.json()).total).toBe(0);});
 it('rejects a fractional page before querying history',async()=>{const response=await invoke({action:'quizzes.list',page:1.5});expect(response.status).toBe(400);expect(state.rpcCalls).toEqual([]);});
});
