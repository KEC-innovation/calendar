import { getSupabase } from '../../lib/supabase';
export async function portal<T>(action:string,body:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await getSupabase().functions.invoke('portal-api',{body:{action,...body}});
 if(error){let message=error.message; if(error.context instanceof Response){try{const response=await error.context.json() as {error?:string};message=response.error||message;}catch{/* response was not JSON */}}throw new Error(message);}
 return data as T;
}
export function message(cause:unknown){return cause instanceof Error?cause.message:'Could not complete the request.';}
export function dateTime(value:string){return new Intl.DateTimeFormat('en-NP',{timeZone:'Asia/Kathmandu',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
export function recoveryUrl(){const url=new URL(window.location.href);url.hash='';url.search='?account=reset';return url.toString();}
