import {describe,it,expect,vi,afterEach} from 'vitest';
import {WorkspaceCache} from '../src/lib/workspaceCache';
afterEach(()=>vi.useRealTimers());
describe('private workspace cache',()=>{
 it('deduplicates pending requests and keeps account keys separate',async()=>{const cache=new WorkspaceCache();let finish!:(value:number)=>void;const fetch=vi.fn(()=>new Promise<number>(resolve=>{finish=resolve;}));const a=cache.get('user-a:dashboard',fetch),b=cache.get('user-a:dashboard',fetch);finish(7);expect(await a).toBe(7);expect(await b).toBe(7);expect(fetch).toHaveBeenCalledTimes(1);expect(cache.peek('user-b:dashboard')).toBeNull();});
 it('expires cache entries after fifteen seconds',async()=>{vi.useFakeTimers();const cache=new WorkspaceCache();await cache.get('a',()=>Promise.resolve(1));vi.advanceTimersByTime(15001);expect(cache.peek('a')).toBeNull();});
 it('does not resurrect old data after sign-out or mutation invalidation',async()=>{const cache=new WorkspaceCache();let finish!:(value:number)=>void;const pending=cache.get('a',()=>new Promise<number>(resolve=>{finish=resolve;}));cache.clear();finish(1);await pending;expect(cache.peek('a')).toBeNull();});
});
