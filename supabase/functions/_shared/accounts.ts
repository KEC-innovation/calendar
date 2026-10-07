import { adminClient } from './supabase.ts';
import { HttpError } from './http.ts';
export async function requireAccount(request: Request, allowPasswordChange = false) {
 const admin=adminClient();
 const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data,error}=await admin.auth.getUser(token);
 if(error||!data.user||!data.user.email_confirmed_at) throw new HttpError(401,'Sign in with a confirmed email address.','AUTH_REQUIRED');
 const {data:security,error:securityError}=await admin.from('account_security').select('*').eq('user_id',data.user.id).maybeSingle();
 if(securityError) throw securityError;
 if(security?.password_change_required && !allowPasswordChange) throw new HttpError(403,'Set your own password in Account before continuing.','PASSWORD_CHANGE_REQUIRED');
 return {user:data.user,security};
}
export { capabilityNames, staffCan, staffCanTrain } from './staffPermissions.ts';
export function appUrl() {
 const url=Deno.env.get('APP_URL');
 if(!url) throw new HttpError(503,'Configure APP_URL before sending invitations or creating training QR codes.','SETUP_REQUIRED');
 const parsed=new URL(url);
 if(parsed.protocol!=='https:' && !['localhost','127.0.0.1'].includes(parsed.hostname)) throw new Error('APP_URL must use HTTPS.');
 parsed.hash='';parsed.search='';return parsed.toString();
}
