import {beforeAll,describe,it,expect} from 'vitest';
let enforce:(user:{factors?:Array<{status:string}>},token:string)=>void;
beforeAll(async()=>{const path='../supabase/functions/_shared/staffMfa.ts';enforce=(await import(path)).enforceStaffMfa;});
const jwt=(aal:string)=>`verified.${btoa(JSON.stringify({aal}))}.signature`;
describe('staff MFA after Auth token verification',()=>{
 it('requires a second factor once an authenticator is verified',()=>expect(()=>enforce({factors:[{status:'verified'}]},jwt('aal1'))).toThrow(/authenticator/));
 it('accepts a verified AAL2 token',()=>expect(()=>enforce({factors:[{status:'verified'}]},jwt('aal2'))).not.toThrow());
 it('denies malformed MFA claims',()=>expect(()=>enforce({factors:[{status:'verified'}]},'broken')).toThrow(/authenticator/));
 it('requires staff to complete authenticator setup before operational access',()=>expect(()=>enforce({factors:[{status:'unverified'}]},jwt('aal1'))).toThrow(/Set up an authenticator/));
});
