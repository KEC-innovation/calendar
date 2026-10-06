import { expect,test } from '@playwright/test';
import type { Page } from '@playwright/test';
const userId='00000000-0000-4000-8000-000000000001';
const typeId='00000000-0000-4000-8000-000000000002';
const machineId='00000000-0000-4000-8000-000000000003';
const quizId='00000000-0000-4000-8000-000000000004';
const user={id:userId,email:'student@example.invalid',aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const jwt=[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',exp:2200000000},'synthetic-signature'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
async function fixture(page:Page,role:'student'|'trainer'='student'){
 const requests:Array<Record<string,unknown>>=[];
 let booked=false;
 await page.route('https://kec-test.supabase.co/**',async route=>{
  const url=new URL(route.request().url());const body=(route.request().postDataJSON()||{}) as Record<string,unknown>;
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return;}
  let data:unknown={};
  if(url.pathname.endsWith('/token'))data={access_token:jwt,refresh_token:'synthetic-refresh',expires_in:36000,token_type:'bearer',user};
  else if(url.pathname.endsWith('/user'))data={user,...user};
  else if(url.pathname.includes('/rest/v1/staff_roles'))data=role==='trainer'?{role:'trainer',display_name:'Training Staff',active:true,capabilities:['training']}:null;
  else if(url.pathname.endsWith('/portal-api')){
   requests.push(body);
   if(body.action==='account.status')data={passwordChangeRequired:false};
   if(body.action==='me.dashboard')data={person:{full_name:'Test Student',email:user.email,category:'kec_student',active:true,booking_privilege_active:true,safety_training_status:'verified',waiver_status:'verified',minor_status:'adult'},certifications:[{id:'cert',status:'active',issued_at:'2026-01-01',certification_types:{id:typeId,display_name:'3D Printing'}}],bookings:booked?[{id:'booking',booking_reference:'KEC-TEST-1',starts_at:'2030-01-07T10:00:00+05:45',ends_at:'2030-01-07T11:00:00+05:45',status:'confirmed',equipment:{display_name:'Test Printer'}}]:[],subscriptions:[],attempts:[],equipment:[{id:machineId,display_name:'Test Printer',external_allowed:true,max_booking_minutes:360,equipment_certification_requirements:[{certification_type_id:typeId}]}]};
   if(body.action==='me.book'){booked=true;data={bookingReference:'KEC-TEST-1'};}
   if(body.action==='me.cancel'){booked=false;data={lateCancellation:false};}
   if(body.action==='training.join')data={attemptToken:'synthetic-attempt'};
   if(body.action==='training.open')data={url:'https://makerspace.example.invalid/#/training/synthetic-qr',expiresAt:'2030-01-01T10:00:00Z'};
   if(body.action==='training.manual')data={id:'manual'};
   if(body.action==='workspace')data={capabilities:['training'],people:[{id:userId,full_name:'Test Student',email:user.email}],types:[{id:typeId,display_name:'3D Printing'}],quizzes:[{id:quizId,display_name:'Test Printing Quiz',duration_minutes:8,pass_mark:16,question_count:20,quiz_certification_mappings:[{certification_type_id:typeId}]}],sessions:[],manual:[],plans:[],subscriptions:[],materials:[]};
   if(body.action==='catalog')data={materials:[],plans:[],equipment:[]};
  }else if(url.pathname.endsWith('/public-api'))data={equipmentId:machineId,date:'2030-01-07',timezone:'Asia/Kathmandu',busy:[]};
  else if(url.pathname.endsWith('/quiz-api')){
   if(body.action==='resume')data={attemptToken:'synthetic-attempt',attemptReference:'QUIZ-TEST',quizName:'Test Printing Quiz',participantName:'Test Student',participantEmail:user.email,trainerName:'Training Staff',passMark:16,maxScore:20,expiresAt:new Date(Date.now()+480000).toISOString(),questions:Array.from({length:20},(_,i)=>({id:`q${i}`,prompt:`Synthetic readiness question ${i+1}`,options:[{id:`a${i}`,label:`Answer ${i+1}`},{id:`b${i}`,label:`Other ${i+1}`}]}))};
   if(body.action==='submit')data={attemptReference:'QUIZ-TEST',score:20,maxScore:20,passMark:16,passed:true,certificationNames:['3D Printing']};
  }
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 return requests;
}
async function login(page:Page,path='/#/account'){
 await page.goto(path);await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-password-123!');await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
}
test('account booking uses own authenticated identity and can be cancelled',async({page})=>{
 const requests=await fixture(page);await login(page);await expect(page.getByRole('heading',{name:'Hello, Test Student.'})).toBeVisible();
 await page.getByLabel('Certified equipment').selectOption(machineId);await page.getByLabel('Starts (Nepal)').fill('2030-01-07T10:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T11:00');await page.getByRole('button',{name:'Confirm booking'}).click();
 await expect(page.getByText('Confirmed: KEC-TEST-1.',{exact:false})).toBeVisible();const request=requests.find(r=>r.action==='me.book');expect(request?.personId).toBeUndefined();expect(request?.startsAt).toBe('2030-01-07T04:15:00.000Z');
 await page.getByRole('button',{name:'Cancel booking',exact:true}).click();await expect(page.getByText('Booking cancelled.',{exact:true})).toBeVisible();
});
test('forgot password presents a neutral confirmation',async({page})=>{
 await fixture(page);await page.goto('/#/account');await page.getByRole('button',{name:'Forgot password',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByRole('button',{name:'Send reset email'}).click();await expect(page.getByText('If this account exists, a reset link will arrive by email.',{exact:false})).toBeVisible();
});
test('QR route survives sign-in and leads through assessment to certification',async({page})=>{
 const requests=await fixture(page);await login(page,'/#/training/synthetic-qr');await page.getByRole('button',{name:'Start / resume my quiz'}).click();await expect(page.getByRole('heading',{name:'Test Printing Quiz'})).toBeVisible();
 expect(requests.find(r=>r.action==='training.join')?.sessionToken).toBe('synthetic-qr');
 for(let i=0;i<20;i++)await page.getByLabel(`Answer ${i+1}`,{exact:true}).check();
 await page.getByRole('button',{name:'Submit final answers'}).click();await expect(page.getByRole('heading',{name:'Equipment training passed'})).toBeVisible();
});
test('trainer sees focused tasks, generates QR and records manual training',async({page})=>{
 const requests=await fixture(page,'trainer');await login(page,'/#/staff/login');await expect(page.getByRole('heading',{name:'Daily operations'})).toBeVisible();await expect(page.getByRole('link',{name:'Staff access',exact:true})).toHaveCount(0);
 await page.getByLabel('Quiz',{exact:true}).selectOption(quizId);await page.getByLabel('Certification awarded').selectOption(typeId);await page.getByRole('button',{name:'Create training QR'}).click();await expect(page.getByAltText('Scan to join the authorized training quiz')).toBeVisible();
 const manual=page.getByRole('heading',{name:'Record training manually'}).locator('..');await manual.getByLabel('Person',{exact:true}).selectOption(userId);await manual.getByLabel('Equipment certification').selectOption(typeId);await manual.getByLabel('Training date').fill('2026-01-01');await manual.getByLabel('Outcome').selectOption('passed');await manual.getByLabel('Evidence / assessment reference').fill('Synthetic practical assessment evidence');await manual.getByRole('button',{name:'Save manual training record'}).click();await expect(page.getByText('Saved. The action is recorded in audit history.',{exact:true})).toBeVisible();expect(requests.some(r=>r.action==='training.manual'&&r.outcome==='passed')).toBe(true);
});
test('policy page explains actual enforcement and fits the viewport',async({page})=>{
 await fixture(page);await page.goto('/#/policies');await expect(page.getByRole('heading',{name:'How we track the rules'})).toBeVisible();await expect(page.getByText('Quiz duration discrepancy',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
