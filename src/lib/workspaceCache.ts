// Private, short-lived memory cache. Never persisted to disk or shared across users.
export class WorkspaceCache {
 private entries = new Map<string, { value: unknown; expires: number }>();
 private pending = new Map<string, Promise<unknown>>();
 private generation = 0;
 clear() { this.generation++; this.entries.clear(); this.pending.clear(); }
 invalidate() { this.clear(); }
 peek<T>(key: string): T | null { const hit=this.entries.get(key); return hit && hit.expires>Date.now()?hit.value as T:null; }
 async get<T>(key:string, fetcher:()=>Promise<T>, force=false):Promise<T> {
  const cached=this.peek<T>(key); if(!force && cached!==null)return cached;
  const existing=this.pending.get(key); if(existing)return existing as Promise<T>;
  const generation=this.generation;
  const task=fetcher().then(value=>{if(generation===this.generation){if(this.entries.size>=30)this.entries.delete(this.entries.keys().next().value!);this.entries.set(key,{value,expires:Date.now()+15000});}return value;}).finally(()=>{if(this.pending.get(key)===task)this.pending.delete(key);});
  this.pending.set(key,task);return task;
 }
}
export const workspaceCache=new WorkspaceCache();
