import { expect,test } from '@playwright/test';
import type { Page } from '@playwright/test';
const userId='00000000-0000-4000-8000-000000000001';
const typeId='00000000-0000-4000-8000-000000000002';
const machineId='00000000-0000-4000-8000-000000000003';
const secondMachineId='00000000-0000-4000-8000-000000000005';
const quizId='00000000-0000-4000-8000-000000000004';
const user={id:userId,email:'student@example.invalid',aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const jwt=[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',exp:2200000000},'synthetic-signature'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
async function fixture(page:Page,role:'student'|'trainer'|'admin'|'owner'|'ambassador'='student', options: {availabilityError?:boolean;delayedEquipment?:boolean;availabilityDelayMs?:number;failedQuiz?:boolean;workspaceDelayMs?:number;people?:boolean;mfa?:boolean;enroll?:boolean;trainingQueue?:boolean} = {}){
 const requests:Array<Record<string,unknown>>=[];
 let trainingRows:Array<Record<string,unknown>>=[];
 let booked=false;
 const factor={id:'synthetic-factor',factor_type:'totp',status:'verified',friendly_name:'KEC phone'};
 let authUser={...user,factors:role==='student'||options.enroll?[]:[factor]};
 const token=(aal:string)=>[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',exp:2200000000,aal},'synthetic-signature'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
 let authToken=role==='student'?jwt:token(options.mfa||options.enroll?'aal1':'aal2');
 const staffRows=[{user_id:userId,display_name:'Owner Staff',role:'owner',active:true,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',capabilities:null,training_certification_type_ids:null},{user_id:secondMachineId,display_name:'Focused Trainer',role:'trainer',active:true,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',capabilities:['training','catalog'],training_certification_type_ids:[typeId]}];
 await page.route('https://kec-test.supabase.co/**',async route=>{
  const url=new URL(route.request().url());const body=(route.request().postDataJSON()||{}) as Record<string,unknown>;
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return;}
  let data:unknown={};
  if(url.pathname.endsWith('/token'))data={access_token:authToken,refresh_token:'synthetic-refresh',expires_in:36000,token_type:'bearer',user:authUser};
  else if(url.pathname.endsWith('/factors')&&route.request().method()==='POST')data={id:factor.id,type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>',secret:'SYNTHETICSETUPKEY',uri:'otpauth://totp/synthetic'}};
  else if(url.pathname.endsWith('/challenge'))data={id:'synthetic-challenge',type:'totp',expires_at:2200000000};
  else if(url.pathname.endsWith('/verify')){if(body.code!=='123456'){await route.fulfill({status:400,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({msg:'Invalid authenticator code.'})});return;}authToken=token('aal2');authUser={...authUser,factors:[factor]};data={access_token:authToken,refresh_token:'synthetic-refresh',expires_in:36000,token_type:'bearer',user:authUser};}
  else if(url.pathname.endsWith('/factors'))data={all:authUser.factors,totp:authUser.factors,phone:[]};
  else if(url.pathname.endsWith('/signup')){requests.push({action:'auth.signup',...body});data={user,session:null};}
  else if(url.pathname.endsWith('/user'))data={...authUser};
  else if(url.pathname.includes('/rest/v1/staff_roles')){requests.push({action:'staff-role.read'});data=role==='student'?null:{role,display_name:role==='trainer'?'Training Staff':role==='owner'?'Owner Staff':'Admin Staff',active:true,capabilities:role==='trainer'?['training']:null};}
  else if(url.pathname.endsWith('/portal-api')){
   requests.push(body);
   if(body.action==='account.training')data={types:[{id:typeId,display_name:'3D Printing'}],requests:trainingRows};
   if(body.action==='account.request-training'){trainingRows=[{id:quizId,status:'pending',contact_phone:body.phone,availability:body.availability,student_note:body.note,scheduled_at:null,staff_note:'',created_at:'2026-10-06T06:00:00Z',certification_types:{display_name:'3D Printing'}}];data={id:quizId};}
   if(body.action==='account.cancel-training'){trainingRows[0]!.status='cancelled';data={ok:true};}
   if(body.action==='training.request-update')data={ok:true};
   if(body.action==='account.status')data={passwordChangeRequired:false};
   if(body.action==='account.overview')data={email:user.email,person:role==='student'?{full_name:'Test Student'}:null,staff:role==='student'?null:{role,display_name:'Owner Staff',active:true}};
   if(body.action==='me.dashboard')data={person:{full_name:'Test Student',email:user.email,category:'kec_student',active:true,booking_privilege_active:true,safety_training_status:'verified',waiver_status:'verified',minor_status:'adult'},certifications:[{id:'cert',status:'active',issued_at:'2026-01-01',certification_types:{id:typeId,display_name:'3D Printing'}}],bookings:booked?[{id:'booking',booking_reference:'KEC-TEST-1',starts_at:'2030-01-07T10:00:00+05:45',ends_at:'2030-01-07T11:00:00+05:45',status:'confirmed',equipment:{display_name:'Test Printer'}}]:[],subscriptions:[],attempts:[],equipment:[{id:machineId,display_name:'Test Printer',external_allowed:true,max_booking_minutes:360,equipment_certification_requirements:[{certification_type_id:typeId}]},{id:secondMachineId,display_name:'Second Printer',external_allowed:true,max_booking_minutes:60,equipment_certification_requirements:[{certification_type_id:typeId}]}]};
   if(body.action==='me.book'){booked=true;data={bookingReference:'KEC-TEST-1'};}
   if(body.action==='me.cancel'){booked=false;data={lateCancellation:false};}
   if(body.action==='training.join')data={attemptToken:'synthetic-attempt'};
   if(body.action==='training.open')data={url:'https://makerspace.example.invalid/#/training/synthetic-qr',expiresAt:'2030-01-01T10:00:00Z'};
   if(body.action==='training.manual')data={id:'manual'};
   if(body.action==='staff.capabilities'){
    const row=staffRows.find(row=>row.user_id===body.userId);
    if(row){row.capabilities=body.capabilities as string[];row.training_certification_type_ids=body.trainingCertificationTypeIds as string[];row.updated_at='2026-02-01T00:00:00Z';}
    data={ok:true};
   }
   if(body.action==='workspace'&&options.workspaceDelayMs)await new Promise(resolve=>setTimeout(resolve,options.workspaceDelayMs));
   if(body.action==='workspace')data={capabilities:role==='ambassador'?[]:['training'],people:[{id:userId,full_name:'Test Student',email:user.email}],types:[{id:typeId,display_name:'3D Printing'}],quizzes:[{id:quizId,display_name:'Test Printing Quiz',duration_minutes:8,pass_mark:16,question_count:20,quiz_certification_mappings:[{certification_type_id:typeId}]}],sessions:[],manual:[],plans:[],subscriptions:[],materials:[],requests:options.trainingQueue?[{id:quizId,status:'pending',contact_phone:'9800000000',availability:'Monday after two pm',student_note:'Beginner printing',scheduled_at:null,staff_note:'',created_at:'2026-10-06T06:00:00Z',people:{full_name:'Test Student',email:user.email},certification_types:{display_name:'3D Printing'}}]:[]};
   if(body.action==='catalog')data={materials:[],plans:[],equipment:[]};
  }else if(url.pathname.endsWith('/admin-api')){
   requests.push(body);
   if(body.action==='dashboard')data={today:[],todayCount:0,upcoming:[],equipment:{active:2,outOfService:0,inactive:0},recentCertifications:[],failedAttempts:options.failedQuiz?[{id:quizId,attempt_reference:'QUIZ-FAILED',score:15,max_score:20,people:{full_name:'Test Student'},quizzes:{display_name:'Printing readiness'}}]:[],calendarFailures:[]};
   if(body.action==='people.list')data={rows:[{id:userId,full_name:'Zeta Student',email:'z@example.invalid',category:'kec_student',active:true,booking_privilege_active:true,safety_training_status:'verified',waiver_status:'verified',minor_status:'adult',certifications:[],quiz_attempts:[{id:quizId,passed:true,score:18,max_score:20,quizzes:{display_name:'Printing readiness'}}]},{id:machineId,full_name:'Alpha Student',email:'a@example.invalid',category:'kec_student',active:true,booking_privilege_active:true,safety_training_status:'verified',waiver_status:'verified',minor_status:'adult',certifications:[],quiz_attempts:[]}],total:2};
   if(body.action==='quizzes.review')data={id:quizId,attempt_reference:'QUIZ-FAILED',score:15,max_score:20,pass_mark:16,passed:false,status:'submitted',submitted_at:'2026-10-06T05:00:00Z',trainer_name_snapshot:'Training Staff',people:{full_name:'Test Student'},quizzes:{display_name:'Printing readiness'},answers:[{was_correct:false,quiz_questions:{prompt:'Keep the work area clear?'},quiz_question_options:{label:'No'}}]};
   if(body.action==='staff.list')data={rows:staffRows,certificationTypes:[{id:typeId,display_name:'3D Printing'},{id:quizId,display_name:'Laser Cutting'}]};
   if(body.action==='staff.update'){
    const row=staffRows.find(row=>row.user_id===body.userId);
    if(row){row.role=String(body.role);row.active=body.active===true;row.updated_at='2026-03-01T00:00:00Z';}
    data={ok:true};
   }
  }else if(url.pathname.endsWith('/public-api')){
   requests.push(body);
   if(options.availabilityDelayMs)await new Promise(resolve=>setTimeout(resolve,options.availabilityDelayMs));
   if(options.availabilityError){await route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({error:'Availability temporarily unavailable.'})});return;}
   if(options.delayedEquipment && body.equipmentId===machineId)await new Promise(resolve=>setTimeout(resolve,250));
   data={equipmentId:body.equipmentId,date:body.date,timezone:'Asia/Kathmandu',openingHours:{openTime:'09:00:00',closeTime:'19:00:00',bookable:true},closures:[],busy:body.equipmentId===machineId?[...(booked?[{startsAt:`${String(body.date)}T10:00:00+05:45`,endsAt:`${String(body.date)}T11:00:00+05:45`}]:[]),{startsAt:`${String(body.date)}T11:00:00+05:45`,endsAt:`${String(body.date)}T12:00:00+05:45`}]:[]};
  }
  else if(url.pathname.endsWith('/quiz-api')){
   if(body.action==='resume')data={attemptToken:'synthetic-attempt',attemptReference:'QUIZ-TEST',quizName:'Test Printing Quiz',participantName:'Test Student',participantEmail:user.email,trainerName:'Training Staff',passMark:16,maxScore:20,expiresAt:new Date(Date.now()+480000).toISOString(),questions:Array.from({length:20},(_,i)=>({id:`q${i}`,prompt:`Synthetic readiness question ${i+1}`,options:[{id:`a${i}`,label:`Answer ${i+1}`},{id:`b${i}`,label:`Other ${i+1}`}]}))};
   if(body.action==='submit')data={attemptReference:'QUIZ-TEST',score:20,maxScore:20,passMark:16,passed:true,certificationNames:['3D Printing']};
  }
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 return requests;
}
async function login(page:Page,path='/#/book'){
 await page.goto(path);await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-password-123!');await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
}
test('account booking uses own authenticated identity and can be cancelled',async({page})=>{
 const requests=await fixture(page);await login(page);await expect(page.getByRole('heading',{name:'Hello, Test Student.'})).toBeVisible();
 await page.getByLabel('Certified equipment').selectOption(machineId);await page.getByLabel('Starts (Nepal)').fill('2030-01-07T10:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T11:00');await page.getByRole('button',{name:'Confirm booking'}).click();
 await expect(page.getByText('Confirmed: KEC-TEST-1.',{exact:false})).toBeVisible();const request=requests.find(r=>r.action==='me.book');expect(request?.personId).toBeUndefined();expect(request?.startsAt).toBe('2030-01-07T04:15:00.000Z');
 const view=page.getByRole('region',{name:'Test Printer availability'});
 await expect(view.getByRole('button',{name:'10:00 AM to 10:30 AM, Reserved',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Cancel booking',exact:true}).click();await expect(page.getByText('Booking cancelled.',{exact:true})).toBeVisible();
 await expect(view.getByRole('button',{name:'10:00 AM to 10:30 AM, Free',exact:true})).toBeEnabled();
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
 await page.getByRole('combobox',{name:'Quiz',exact:true}).selectOption(quizId);await page.getByLabel('Certification awarded').selectOption(typeId);await page.getByRole('button',{name:'Create training QR'}).click();await expect(page.getByAltText('Scan to join the authorized training quiz')).toBeVisible();
 const manual=page.getByRole('heading',{name:'Record training manually'}).locator('..');await manual.getByRole('combobox',{name:'Person',exact:true}).selectOption(userId);await manual.getByLabel('Equipment certification').selectOption(typeId);await manual.getByLabel('Training date').fill('2026-01-01');await manual.getByLabel('Outcome').selectOption('passed');await manual.getByLabel('Evidence / assessment reference').fill('Synthetic practical assessment evidence');await manual.getByRole('button',{name:'Save manual training record'}).click();await expect(page.getByText('Saved. The action is recorded in audit history.',{exact:true})).toBeVisible();expect(requests.some(r=>r.action==='training.manual'&&r.outcome==='passed')).toBe(true);
});
test('policy page explains actual enforcement and fits the viewport',async({page})=>{
 await fixture(page);await page.goto('/#/policies');await expect(page.getByRole('heading',{name:'How we track the rules'})).toBeVisible();await expect(page.getByText('Quiz duration discrepancy',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('chosen equipment shows reservations and a free block fills booking times',async({page})=>{
 const requests=await fixture(page);await login(page);
 await page.getByLabel('Starts (Nepal)').fill('2030-01-07T10:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T11:00');
 await page.getByLabel('Certified equipment').selectOption(machineId);
 const view=page.getByRole('region',{name:'Test Printer availability'});
 await expect(view.getByRole('button',{name:'11:00 AM to 11:30 AM, Reserved',exact:true})).toBeDisabled();
 await view.getByRole('button',{name:'9:00 AM to 9:30 AM, Free',exact:true}).click();
 await expect(page.getByLabel('Starts (Nepal)')).toHaveValue('2030-01-07T09:00');
 await expect(page.getByLabel('Ends (Nepal)')).toHaveValue('2030-01-07T09:30');
 expect(requests.filter(r=>r.action==='availability').every(r=>r.equipmentId===machineId)).toBe(true);
 await view.screenshot({path:test.info().outputPath('equipment-availability.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('switching equipment never shows an older machine response',async({page})=>{
 await fixture(page,'student',{delayedEquipment:true});await login(page);
 await page.getByLabel('Starts (Nepal)').fill('2030-01-07T10:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T11:00');
 await page.getByLabel('Certified equipment').selectOption(machineId);
 await page.getByLabel('Certified equipment').selectOption(secondMachineId);
 const view=page.getByRole('region',{name:'Second Printer availability'});
 await expect(view.getByRole('button',{name:'11:00 AM to 11:30 AM, Free',exact:true})).toBeEnabled();
 await expect(page.getByRole('region',{name:'Test Printer availability'})).toHaveCount(0);
 await expect(view.getByRole('button',{name:/Reserved/})).toHaveCount(0);
});
test('calendar date changes reload availability for only that equipment',async({page})=>{
 const requests=await fixture(page);await login(page);
 await page.getByLabel('Starts (Nepal)').fill('2030-01-07T10:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T11:00');
 await page.getByLabel('Certified equipment').selectOption(machineId);
 const view=page.getByRole('region',{name:'Test Printer availability'});
 await view.getByLabel('View date (Nepal)').fill('2030-01-08');
 await expect(page.getByLabel('Starts (Nepal)')).toHaveValue('2030-01-08T10:00');
 await expect(page.getByLabel('Ends (Nepal)')).toHaveValue('2030-01-08T11:00');
 await expect(view.getByRole('button',{name:'9:00 AM to 9:30 AM, Free',exact:true})).toBeEnabled();
 expect(requests.some(r=>r.action==='availability'&&r.date==='2030-01-08'&&r.equipmentId===machineId)).toBe(true);
 await page.getByLabel('Starts (Nepal)').fill('');
 await expect(view.getByRole('heading',{name:'Test Printer availability'})).toBeVisible();
});
test('failed availability lookup does not display invented free slots',async({page})=>{
 await fixture(page,'student',{availabilityError:true});await login(page);
 await page.getByLabel('Certified equipment').selectOption(machineId);
 const view=page.getByRole('region',{name:'Test Printer availability'});
 await expect(view.getByRole('alert')).toContainText('Availability temporarily unavailable.');
 await expect(view.getByRole('button',{name:/, Free$/})).toHaveCount(0);
 await expect(view.getByRole('button',{name:'Refresh availability'})).toBeEnabled();
});


test('recent machine availability is reused and manual refresh reaches the server',async({page})=>{
 const requests=await fixture(page,'student',{availabilityDelayMs:350});await login(page);
 await page.getByLabel('Starts (Nepal)').fill('2030-01-07T10:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T11:00');
 await page.getByLabel('Certified equipment').selectOption(machineId);
 await expect(page.getByRole('region',{name:'Test Printer availability'}).getByRole('button',{name:'9:00 AM to 9:30 AM, Free',exact:true})).toBeEnabled();
 const firstCount=requests.filter(r=>r.action==='availability'&&r.equipmentId===machineId).length;
 await page.getByLabel('Certified equipment').selectOption(secondMachineId);
 await expect(page.getByRole('region',{name:'Second Printer availability'}).getByRole('button',{name:'11:00 AM to 11:30 AM, Free',exact:true})).toBeEnabled();
 const start=Date.now();await page.getByLabel('Certified equipment').selectOption(machineId);
 const view=page.getByRole('region',{name:'Test Printer availability'});
 await expect(view.getByRole('button',{name:'9:00 AM to 9:30 AM, Free',exact:true})).toBeEnabled();
 console.log(`Availability revisit with simulated 350ms API delay: ${Date.now()-start}ms`);
 expect(requests.filter(r=>r.action==='availability'&&r.equipmentId===machineId)).toHaveLength(firstCount);
 await view.getByRole('button',{name:'Refresh availability'}).click();
 await expect.poll(()=>requests.filter(r=>r.action==='availability'&&r.equipmentId===machineId).length).toBeGreaterThan(firstCount);
 await expect(view.getByRole('button',{name:'9:00 AM to 9:30 AM, Free',exact:true})).toBeEnabled();
});
test('student page reload skips staff-role lookup and staff entry still checks it',async({page})=>{
 const requests=await fixture(page);await login(page);await expect(page.getByRole('heading',{name:'Hello, Test Student.'})).toBeVisible();
 requests.length=0;await page.reload();await expect(page.getByRole('heading',{name:'Hello, Test Student.'})).toBeVisible();
 expect(requests.filter(r=>r.action==='staff-role.read')).toHaveLength(0);
 await page.getByRole('link',{name:'Staff',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Staff sign in',exact:true})).toBeVisible();
 expect(requests.some(r=>r.action==='staff-role.read')).toBe(true);
});
test('a stored trainer session restores when entering the staff screen',async({page})=>{
 const requests=await fixture(page,'trainer');await login(page,'/#/staff/login');
 await expect(page.getByRole('heading',{name:'Daily operations'})).toBeVisible();
 requests.length=0;await page.reload();await expect(page.getByRole('heading',{name:'Daily operations'})).toBeVisible();
 expect(requests.some(r=>r.action==='staff-role.read')).toBe(true);
});


test('Owner sees current assignments and saves specific training authority with evidence',async({page})=>{
 const requests=await fixture(page,'owner');await login(page,'/#/staff/login');
 await expect(page.getByRole('navigation',{name:'Staff workspace'})).toBeAttached();
 if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 await page.getByRole('link',{name:'Staff access',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Staff access',exact:true})).toBeVisible();
 await page.getByLabel('Staff member',{exact:true}).selectOption(secondMachineId);
 await expect(page.getByLabel('Run QR quizzes and record equipment training',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Maintain published materials and electronics',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Verify one-time safety, waiver and age records; invite accounts',{exact:true})).not.toBeChecked();
 await expect(page.getByLabel('3D Printing',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Laser Cutting',{exact:true})).not.toBeChecked();
 await page.getByLabel('3D Printing',{exact:true}).uncheck();
 await expect(page.getByRole('button',{name:'Save responsibilities',exact:true})).toBeDisabled();
 await page.getByLabel('Laser Cutting',{exact:true}).check();
 await page.getByLabel('Eligibility / responsibility review note',{exact:true}).fill('Verified laser certification and practical trainer eligibility.');
 await page.getByRole('button',{name:'Save responsibilities',exact:true}).click();
 await expect(page.getByLabel('Staff member',{exact:true})).toHaveValue(secondMachineId);
 await expect(page.getByLabel('Laser Cutting',{exact:true})).toBeChecked();
 await expect.poll(()=>requests.filter(r=>r.action==='staff.list').length).toBeGreaterThan(1);
 const request=requests.find(r=>r.action==='staff.capabilities');
 expect(request?.trainingCertificationTypeIds).toEqual([quizId]);expect(request?.capabilities).toEqual(['training','catalog']);
 expect(request?.reason).toBe('Verified laser certification and practical trainer eligibility.');
 const row=page.getByRole('row').filter({has:page.getByText('Focused Trainer',{exact:true})});
 await expect(row).toContainText('Laser Cutting');
 await page.getByRole('button',{name:'Edit access for Owner Staff',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Review staff access'});
 await expect(dialog.getByLabel('Active staff access')).toBeDisabled();
 await expect(dialog.getByText('The final active Owner must remain active with Owner access.')).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('staff-responsibilities.png'),fullPage:true});
});
test('Owner reviews activation changes without clearing assigned duties',async({page})=>{
 const requests=await fixture(page,'owner');await login(page,'/#/staff/login');
 await expect(page.getByRole('navigation',{name:'Staff workspace'})).toBeAttached();
 if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 await page.getByRole('link',{name:'Staff access',exact:true}).click();
 await page.getByRole('button',{name:'Edit access for Focused Trainer',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Review staff access'});
 await expect(dialog.getByLabel('Role',{exact:true})).toHaveValue('trainer');
 await dialog.getByLabel('Active staff access',{exact:true}).uncheck();
 await dialog.getByLabel('Access review note',{exact:true}).fill('Staff member is away; retain their reviewed responsibilities.');
 await dialog.getByRole('button',{name:'Save staff access',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 const request=requests.find(r=>r.action==='staff.update');expect(request?.role).toBe('trainer');expect(request?.active).toBe(false);expect(request?.capabilities).toBeUndefined();
 const row=page.getByRole('row').filter({has:page.getByText('Focused Trainer',{exact:true})});
 await expect(row).toContainText('Inactive');await expect(row).toContainText('training, catalog');await expect(row).toContainText('3D Printing');
});
test('Admin keeps all operational navigation without Owner staff management',async({page})=>{
 await fixture(page,'admin');await login(page,'/#/staff/login');
 await expect(page.getByRole('navigation',{name:'Staff workspace'})).toBeAttached();
 if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 const navigation=page.getByRole('navigation',{name:'Staff workspace'});
 for(const name of ['Overview','Equipment','People','Certifications','Bookings','Training','Hours & closures','Audit trail'])await expect(navigation.getByRole('link',{name,exact:true})).toBeVisible();
 await expect(navigation.getByRole('link',{name:'Staff access',exact:true})).toHaveCount(0);
});

async function openStaffLink(page:Page,name:string){await expect(page.getByRole('navigation',{name:'Staff workspace'})).toBeAttached();if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('link',{name,exact:true}).click();}
test('Owner can open Home and My account without a student record',async({page})=>{
 const requests=await fixture(page,'owner');await login(page,'/#/staff/login');await expect(page.getByRole('heading',{name:/Good day/})).toBeVisible();await page.goto('/#/');await expect(page.getByRole('link',{name:'Register / first sign in'})).toBeVisible();await page.getByRole('link',{name:'My account / sign in'}).click();await expect(page.getByRole('heading',{name:'Owner workspace'})).toBeVisible();await expect(page.getByRole('link',{name:'Open staff workspace'})).toBeVisible();await expect(page.getByText('Ask the desk to add your Makerspace record',{exact:false})).toHaveCount(0);expect(requests.some(r=>r.action==='me.dashboard')).toBe(false);await page.screenshot({path:test.info().outputPath('owner-account.png'),fullPage:true});
});
test('registration collects profile and preserves the existing trainee route',async({page})=>{
 const requests=await fixture(page);await page.goto('/#/register');await page.getByLabel('Full name',{exact:true}).fill('New Student');await page.getByLabel('Roll number',{exact:true}).fill('KEC-001');await page.getByLabel('Phone',{exact:true}).fill('9800000000');await page.getByLabel('Email',{exact:true}).fill('new@example.invalid');await page.getByLabel('Password',{exact:true}).fill('Safe-password-123!');await page.getByLabel('Confirm password',{exact:true}).fill('Safe-password-123!');await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('status')).toContainText('If you already have an account');expect((requests.find(r=>r.action==='auth.signup')?.data as {registration_profile:{fullName:string}})?.registration_profile.fullName).toBe('New Student');await page.getByRole('checkbox',{name:'Already trained?',exact:false}).check();await expect(page.getByLabel('Full name',{exact:true})).toHaveCount(0);await expect(page.getByText('We will retain your existing details and passes.',{exact:false})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('two clicks select a booking interval and typed times still work',async({page})=>{
 await fixture(page);await login(page);await page.getByLabel('Starts (Nepal)').fill('2030-01-07T09:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T09:30');await page.getByLabel('Certified equipment').selectOption(machineId);const view=page.getByRole('region',{name:'Test Printer availability'});await view.getByRole('button',{name:'9:00 AM to 9:30 AM, Free',exact:true}).click();await view.getByRole('button',{name:'10:00 AM to 10:30 AM, Free',exact:true}).click();await expect(page.getByLabel('Starts (Nepal)')).toHaveValue('2030-01-07T09:00');await expect(page.getByLabel('Ends (Nepal)')).toHaveValue('2030-01-07T10:30');await view.getByRole('button',{name:'10:00 AM to 10:30 AM, Free',exact:true}).click();await view.getByRole('button',{name:'12:00 PM to 12:30 PM, Free',exact:true}).click();await expect(view.getByRole('alert')).toContainText('overlaps a reservation');await page.getByLabel('Starts (Nepal)').fill('2030-01-07T13:00');await page.getByLabel('Ends (Nepal)').fill('2030-01-07T14:00');await expect(page.getByLabel('Ends (Nepal)')).toHaveValue('2030-01-07T14:00');
});
test('MS Ambassador is a real role with a clear integration placeholder',async({page})=>{
 const requests=await fixture(page,'ambassador');await login(page,'/#/staff/login');await expect(page.getByText('Filament and electronics requests still use the separate system',{exact:false})).toBeVisible();expect(requests.find(r=>r.action==='workspace')?.task).toBe('');await expect(page.getByRole('button',{name:'Create training QR'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save catalog item'})).toHaveCount(0);
});
test('Review opens saved quiz evidence instead of an inert badge',async({page})=>{
 const requests=await fixture(page,'owner',{failedQuiz:true});await login(page,'/#/staff/login');await page.getByRole('button',{name:'Review',exact:true}).click();const review=page.getByRole('dialog',{name:'Training result review'});await expect(review.getByText('Keep the work area clear?',{exact:true})).toBeVisible();await expect(review.getByText('Incorrect',{exact:true})).toBeVisible();await review.getByLabel('Review / follow-up note',{exact:true}).fill('Arrange another supervised practical session');await review.getByRole('button',{name:'Record review in audit history'}).click();await expect(review.getByRole('status')).toContainText('Review note saved');expect(requests.some(r=>r.action==='quizzes.review')).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('quiz-review.png'),fullPage:true});
});
test('People headings sort and training evidence is readable within a half window',async({page})=>{
 const requests=await fixture(page,'owner',{people:true});await login(page,'/#/staff/login');await openStaffLink(page,'People');await page.getByRole('columnheader',{name:/^Person/}).getByRole('button').click();await expect.poll(()=>requests.filter(r=>r.action==='people.list').length).toBeGreaterThan(1);expect(requests.filter(r=>r.action==='people.list').at(-1)?.sortKey).toBe('full_name');await page.getByText('View passed training results',{exact:true}).click();await expect(page.getByRole('button',{name:'Review evidence',exact:true})).toBeVisible();if(test.info().project.name==='desktop'){await page.setViewportSize({width:760,height:740});await expect.poll(()=>page.locator('.admin-sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);}expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await expect(page.locator('.table-scroll')).toHaveCSS('overflow','auto');await page.screenshot({path:test.info().outputPath('people-half-window.png'),fullPage:true});
});
test('returning to responsibilities uses a private short-lived cache',async({page})=>{
 const requests=await fixture(page,'trainer',{workspaceDelayMs:350});await login(page,'/#/staff/login');await expect(page.getByRole('button',{name:'Create training QR'})).toBeVisible();await page.goto('/#/');await expect(page.getByRole('link',{name:'Register / first sign in'})).toBeVisible();await page.goto('/#/staff/operations');await expect(page.getByRole('button',{name:'Create training QR'})).toBeVisible();expect(requests.filter(r=>r.action==='workspace')).toHaveLength(1);
});

test('staff must verify an authenticator before operational requests are sent',async({page})=>{
 const requests=await fixture(page,'owner',{mfa:true});await login(page,'/#/staff/login');await expect(page.getByRole('heading',{name:'Verify your sign in'})).toBeVisible();expect(requests.some(r=>r.action==='dashboard')).toBe(false);await page.getByLabel('Authenticator code',{exact:true}).fill('000000');await page.getByRole('button',{name:'Verify sign in',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Invalid authenticator code');expect(requests.some(r=>r.action==='dashboard')).toBe(false);await page.getByLabel('Authenticator code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify sign in',exact:true}).click();await expect(page.getByRole('heading',{name:/Good day/})).toBeVisible();
});
test('unenrolled staff can set up an authenticator before entering the workspace',async({page})=>{
 const requests=await fixture(page,'owner',{enroll:true});await login(page,'/#/staff/login');await expect(page.getByRole('heading',{name:'Secure your staff account'})).toBeVisible();expect(requests.some(r=>r.action==='dashboard')).toBe(false);await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await expect(page.getByAltText('Authenticator setup QR')).toBeVisible();await page.getByLabel('Authenticator code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Enable two-step sign-in',exact:true}).click();await expect(page.getByRole('heading',{name:/Good day/})).toBeVisible();
});

test('registered students can request training with contact and availability',async({page})=>{
 const requests=await fixture(page);await login(page,'/#/account');await page.getByRole('combobox',{name:'Equipment training',exact:true}).selectOption(typeId);await page.getByLabel('Contact number',{exact:true}).fill('9800000000');await page.getByLabel('Preferred days and times',{exact:true}).fill('Monday or Wednesday after 2 pm');await page.getByRole('button',{name:'Send training request'}).click();await expect(page.getByText('Training requested.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Cancel training request'})).toBeVisible();const sent=requests.find(r=>r.action==='account.request-training');expect(sent?.phone).toBe('9800000000');expect(sent?.userId).toBeUndefined();await expect(page.getByRole('link',{name:'Ask the Makerspace help desk'})).toBeVisible();await page.getByRole('button',{name:'Cancel training request'}).click();await expect(page.getByText('Training request cancelled.',{exact:false})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('student-training-request.png'),fullPage:true});
});
test('assigned trainers can place a training request in the next session',async({page})=>{
 const requests=await fixture(page,'trainer',{trainingQueue:true});await login(page,'/#/staff/login');await page.getByText('Schedule / update request',{exact:true}).click();await page.getByRole('combobox',{name:'Request state',exact:true}).selectOption('scheduled');await page.getByLabel('Session starts (Nepal)',{exact:true}).fill('2030-01-07T14:00');await page.getByLabel('Session instructions / staff note',{exact:true}).fill('Meet Training Staff at the Makerspace desk');await page.getByRole('button',{name:'Save training request'}).click();await expect.poll(()=>requests.filter(r=>r.action==='training.request-update').length).toBe(1);expect(requests.find(r=>r.action==='training.request-update')?.scheduledAt).toBe('2030-01-07T08:15:00.000Z');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('staff-training-queue.png'),fullPage:true});
});
