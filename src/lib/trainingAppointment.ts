export interface TrainingPreference {preferred_date?:string|null;preferred_start?:string|null;preferred_end?:string|null;scheduled_at:string|null;scheduled_end_at?:string|null;status:string}
export function requiresContact(request:TrainingPreference,start:string,end:string):boolean {
 const a=new Date(start).getTime(),b=new Date(end).getTime();
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return false;
 if(request.status==='scheduled'&&(a!==new Date(request.scheduled_at||'').getTime()||b!==new Date(request.scheduled_end_at||'').getTime()))return true;
 if(!request.preferred_date||!request.preferred_start||!request.preferred_end)return false;
 return a<new Date(`${request.preferred_date}T${request.preferred_start}+05:45`).getTime()||b>new Date(`${request.preferred_date}T${request.preferred_end}+05:45`).getTime();
}
export function nepalTimestamp(value:string){return value?new Date(`${value}+05:45`).toISOString():null;}
