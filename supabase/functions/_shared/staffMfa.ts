import { HttpError } from './http.ts';
export function enforceStaffMfa(user:{factors?:Array<{status:string}>},verifiedToken:string){
 if(!user.factors?.some(factor=>factor.status==='verified'))throw new HttpError(403,'Set up an authenticator in My account before opening the staff workspace.','MFA_SETUP_REQUIRED');
 let aal:string|undefined;
 try{const payload=verifiedToken.split('.')[1]!;aal=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/'))).aal;}catch{/* Fail closed on malformed claims; caller must verify the JWT with Auth first. */}
 if(aal!=='aal2')throw new HttpError(403,'Verify your authenticator code before opening the staff workspace.','MFA_REQUIRED');
}
