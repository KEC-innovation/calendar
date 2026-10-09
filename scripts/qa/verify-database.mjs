import console from 'node:console';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const db=new PGlite({extensions:{pgcrypto,btree_gist,citext}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users(id),status text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
set search_path=public,extensions;
select set_config('request.jwt.claims','{"aal":"aal1"}',false);`);
for(const f of readdirSync(root+'/supabase/migrations').sort())await db.exec(readFileSync(root+'/supabase/migrations/'+f,'utf8'));
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=uid(1),trainer=uid(2),access=uid(3),student=uid(4),other=uid(5),unconfirmed=uid(6),person=uid(14),otherPerson=uid(15),quiz=uid(20),session=uid(21);
await db.exec(`insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.invalid',now()),('${trainer}','trainer@example.invalid',now()),('${access}','access@example.invalid',now()),('${student}','student@example.invalid',now()),('${other}','other@example.invalid',now()),('${unconfirmed}','student@example.invalid',null);
insert into staff_roles(user_id,display_name,role,capabilities) values ('${owner}','Owner','owner',null),('${trainer}','Trainer','trainer',null),('${access}','Access officer','viewer',array['access']);
insert into people(id,email,full_name,category,roll_number,safety_training_status,waiver_status,minor_status) values('${person}','student@example.invalid','Synthetic student','kec_student','10','verified','verified','adult'),('${otherPerson}','other@example.invalid','Synthetic other','kec_student','10','verified','verified','adult');`);
const type=(await db.query("select id from certification_types where slug='3d-printing'")).rows[0].id;
const machine=(await db.query('select e.id from equipment e join equipment_certification_requirements r on r.equipment_id=e.id where r.certification_type_id=$1 and e.booking_enabled limit 1',[type])).rows[0].id;
await db.exec(`begin;insert into quizzes(id,slug,display_name,question_count,pass_mark,duration_minutes,active)values('${quiz}','synthetic-bank','Synthetic bank',20,16,8,true);
insert into quiz_certification_mappings values('${quiz}','${type}',now());`);
const answers=[];
for(let i=0;i<20;i++){const qid=uid(100+i),correct=uid(200+i),wrong=uid(300+i);await db.query('insert into quiz_questions(id,quiz_id,prompt,position) values($1,$2,$3,$4)',[qid,quiz,`Synthetic question ${i+1}`,i+1]);await db.query('insert into quiz_question_options(id,question_id,label,position,is_correct) values($1,$2,$3,1,true),($4,$2,$5,2,false)',[correct,qid,`Correct ${i}`,wrong,`Wrong ${i}`]);answers.push({questionId:qid,optionId:correct});}
await db.exec('commit');
await db.query(`insert into training_sessions(id,token_hash,quiz_id,quiz_version,certification_type_id,trainer_user_id,trainer_name,expires_at,capacity) values($1,'sessionhash',$2,1,$3,$4,'Trainer',now()+interval '30 minutes',1)`,[session,quiz,type,trainer]);
let count=0;
async function check(name,task){await db.exec('begin');try{await task();count++;console.log('PASS '+name);}finally{await db.exec('rollback');}}
async function rejects(sql,args,pattern){let caught;try{await db.query(sql,args);}catch(e){caught=e;}assert.ok(caught,'expected rejection');if(pattern)assert.match(caught.message,pattern);}
const join=()=>db.query("select start_training_session_attempt($1,'sessionhash','attempt-hash') id",[student]);
await check('existing people with shared roll numbers remain distinct',async()=>assert.equal((await db.query("select count(*)::int n from people where roll_number='10'")).rows[0].n,2));
await check('verified email links to existing person, without rewriting evidence',async()=>{assert.equal((await db.query('select link_person_account($1) id',[student])).rows[0].id,person);assert.equal((await db.query('select count(*)::int n from people')).rows[0].n,2);});
await check('unconfirmed email cannot claim a person',()=>rejects('select link_person_account($1)',[unconfirmed],/Confirm your email/));
await check('student cannot call trusted identity RPC directly',async()=>{await db.exec('set local role authenticated');await rejects('select link_person_account($1)',[other],/permission denied/);});
await check('anonymous cannot enumerate people',async()=>{await db.exec('set local role anon');await rejects('select * from people',[],/permission denied/);});
await check('student cannot read answer keys',async()=>{await db.exec('set local role authenticated');await rejects('select * from quiz_question_options',[],/permission denied/);});
await check('scoped staff cannot bypass API with direct directory reads',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[trainer]);await db.exec('set local role authenticated');await rejects('select * from people',[],/permission denied/);});
await check('scoped staff cannot read other staff permissions',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[trainer]);await db.exec('set local role authenticated');assert.equal((await db.query('select count(*)::int n from staff_roles')).rows[0].n,1);});
await check('training capability does not imply access or subscription management',async()=>{const row=(await db.query("select private.staff_can($1,'training') t,private.staff_can($1,'access') a,private.staff_can($1,'subscriptions') s",[trainer])).rows[0];assert.deepEqual(row,{t:true,a:false,s:false});});
await check('access officer cannot record a training pass',()=>rejects('select record_manual_training($1,$2,$3,current_date,$4,$5,$6)',[access,person,type,'Trainer','Documented practical assessment','passed'],/Training permission/));
await check('manual pass records evidence and issues one certification',async()=>{await db.query('select record_manual_training($1,$2,$3,current_date,$4,$5,$6)',[trainer,person,type,'Trainer','Documented practical assessment','passed']);assert.equal((await db.query('select count(*)::int n from certifications where person_id=$1',[person])).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from manual_training_records')).rows[0].n,1);});
await check('attendance alone does not grant certification',async()=>{await db.query('select record_manual_training($1,$2,$3,current_date,$4,$5,$6)',[trainer,person,type,'Trainer','Attended supervised workshop','attended']);assert.equal((await db.query('select count(*)::int n from certifications')).rows[0].n,0);});
await check('manual future training date is rejected',()=>rejects('select record_manual_training($1,$2,$3,current_date+1,$4,$5,$6)',[trainer,person,type,'Trainer','Documented practical assessment','passed'],/valid training date/));
await check('manual entry cannot bypass a suspension',async()=>{await db.query("insert into certifications(person_id,certification_type_id,status,suspended_at)values($1,$2,'suspended',now())",[person,type]);await rejects('select record_manual_training($1,$2,$3,current_date,$4,$5,$6)',[trainer,person,type,'Trainer','Documented practical assessment','passed'],/Suspended or revoked/);});
await check('QR creates randomized account-bound attempt with exactly 20 questions',async()=>{await join();const a=(await db.query('select * from quiz_attempts')).rows[0];assert.equal(a.account_user_id,student);assert.equal(a.authorized_certification_type_id,type);assert.equal(a.question_order.length,20);assert.equal(Object.keys(a.option_order).length,20);assert.equal((new Date(a.expires_at)-new Date(a.started_at))/60000,8);});
for(const [name,setup,pattern] of [
 ['expired QR',`update training_sessions set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'`,/expired/],
 ['closed QR',`update training_sessions set revoked_at=now()`,/expired|closed/],
 ['deactivated trainer',`update staff_roles set active=false where user_id='${trainer}'`,/permission/],
 ['changed quiz version',`update quizzes set version=version+1 where id='${quiz}'`,/Quiz changed/],
 ['missing safety',`update people set safety_training_status='unknown' where id='${person}'`,/verify/],
 ['missing waiver',`update people set waiver_status='unknown' where id='${person}'`,/verify/],
 ['minor',`update people set minor_status='minor' where id='${person}'`,/verify/],
 ['outreach category',`update people set category='outreach_minor' where id='${person}'`,/verify/],
 ['inactive person',`update people set active=false where id='${person}'`,/verify/],
])await check(name+' cannot join',async()=>{await db.exec(setup);await rejects("select start_training_session_attempt($1,'sessionhash','a')",[student],pattern);});
await check('one attempt per person per QR session',async()=>{await join();await rejects("select start_training_session_attempt($1,'sessionhash','different')",[student],/already joined/);});
await check('QR capacity cannot be exceeded',async()=>{await join();await rejects("select start_training_session_attempt($1,'sessionhash','different')",[other],/full/);});
await check('16 of 20 passes and issues the authorized certificate',async()=>{await join();const chosen=answers.map((a,i)=>i<16?a:{...a,optionId:uid(300+i)});const result=(await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(chosen)])).rows[0].result;assert.equal(result.passed,true);assert.equal(result.score,16);assert.equal((await db.query('select count(*)::int n from certifications where status=\'active\'')).rows[0].n,1);});
await check('15 of 20 fails without a certification',async()=>{await join();const chosen=answers.map((a,i)=>i<15?a:{...a,optionId:uid(300+i)});const result=(await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(chosen)])).rows[0].result;assert.equal(result.passed,false);assert.equal((await db.query('select count(*)::int n from certifications')).rows[0].n,0);});
await check('expired attempt cannot grant a pass',async()=>{await join();await db.exec("update quiz_attempts set started_at=now()-interval '20 minutes',expires_at=now()-interval '12 minutes'");assert.equal((await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(answers)])).rows[0].result.code,'EXPIRED');});
await check('QR closure does not shorten an already-started assessment',async()=>{await join();await db.exec('update training_sessions set revoked_at=now()');assert.equal((await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(answers)])).rows[0].result.passed,true);});
await check('submission cannot repeat or issue duplicate certificates',async()=>{await join();await db.query("select submit_quiz_attempt('attempt-hash',$1)",[JSON.stringify(answers)]);assert.equal((await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(answers)])).rows[0].result.code,'ALREADY_SUBMITTED');});
await check('suspension during assessment is not bypassed by passing',async()=>{await join();await db.query("insert into certifications(person_id,certification_type_id,status,suspended_at)values($1,$2,'suspended',now())",[person,type]);const result=(await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(answers)])).rows[0].result;assert.equal(result.passed,true);assert.equal(result.certificationNames.length,0);assert.equal((await db.query("select count(*)::int n from certifications where status='active'")).rows[0].n,0);});
await check('passing enables account booking immediately with verified prerequisites',async()=>{await join();await db.query("select submit_quiz_attempt('attempt-hash',$1)",[JSON.stringify(answers)]);const result=(await db.query('select book_for_account($1,$2,$3,$4,$5) result',[student,machine,'2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45','Synthetic project'])).rows[0].result;assert.ok(result.bookingReference);assert.equal((await db.query('select requested_by from bookings')).rows[0].requested_by,student);});
await check('account booking still requires certification',()=>rejects('select book_for_account($1,$2,$3,$4,$5)',[student,machine,'2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45','Synthetic project'],/certification/));
await check('student cannot cancel another person booking',async()=>{await join();await db.query("select submit_quiz_attempt('attempt-hash',$1)",[JSON.stringify(answers)]);await db.query('select book_for_account($1,$2,$3,$4,$5)',[student,machine,'2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45','Synthetic project']);const id=(await db.query('select id from bookings')).rows[0].id;await rejects('select cancel_for_account($1,$2)',[other,id],/not found in your account/);});
await check('own cancellation releases booking and records state',async()=>{await join();await db.query("select submit_quiz_attempt('attempt-hash',$1)",[JSON.stringify(answers)]);await db.query('select book_for_account($1,$2,$3,$4,$5)',[student,machine,'2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45','Synthetic project']);const id=(await db.query('select id from bookings')).rows[0].id;await db.query('select cancel_for_account($1,$2)',[student,id]);assert.equal((await db.query('select status from bookings')).rows[0].status,'cancelled');});
await check('20 policy subscription plans have explicit scope',async()=>{const rows=(await db.query('select * from subscription_plans')).rows;assert.equal(rows.length,20);assert.ok(rows.every(p=>p.minimum_months===3&&p.certification_type_ids.length>0));assert.ok(rows.filter(p=>p.name.startsWith('All equipment without')).every(p=>p.certification_type_ids.length===3));});
const plan=(await db.query("select id from subscription_plans where name like '3D Printing%' and pricing_tier='external'")).rows[0].id;
await check('three calendar months and price are computed transactionally',async()=>{await db.query('select add_client_subscription($1,$2,$3,$4,3,$5)',[owner,otherPerson,plan,'2030-01-31','Synthetic agreement']);const row=(await db.query('select ends_on,agreed_total_npr from client_subscriptions')).rows[0];assert.equal(new Date(row.ends_on).toISOString().slice(0,10),'2030-04-30');assert.equal(Number(row.agreed_total_npr),3000);});
await check('two-month subscription is rejected',()=>rejects('select add_client_subscription($1,$2,$3,$4,2,$5)',[owner,otherPerson,plan,'2030-01-01','Synthetic agreement'],/Invalid subscription term/));
await check('trainer cannot create a subscription',()=>rejects('select add_client_subscription($1,$2,$3,$4,3,$5)',[trainer,otherPerson,plan,'2030-01-01','Synthetic agreement'],/permission/));
await check('new password clears initial-password restriction',async()=>{await db.query('insert into account_security(user_id,password_change_required)values($1,true)',[student]);await db.query("update auth.users set encrypted_password='synthetic hash' where id=$1",[student]);assert.equal((await db.query('select password_change_required from account_security')).rows[0].password_change_required,false);});
await check('access officer can record compliance evidence atomically',async()=>{await db.query('select verify_person_records($1,$2,$3,$4,$5,$6)',[access,person,'verified','verified','adult','Verified existing signed waiver and induction attendance']);assert.equal((await db.query("select count(*)::int n from audit_log where action='compliance_evidence_recorded'")).rows[0].n,1);});
await check('trainer cannot verify access prerequisites',()=>rejects('select verify_person_records($1,$2,$3,$4,$5,$6)',[trainer,person,'verified','verified','adult','Synthetic evidence review'],/Access permission/));
// Owner access and equipment training policy controls.
const adminUser=uid(7),secondOwner=uid(8);
const otherType=(await db.query('select id from certification_types where id<>$1 and active limit 1',[type])).rows[0].id;
async function staffChange(actor,target,mode,role=null,active=null,caps=null,types=null,reason='Documented staff responsibility and eligibility review') {
 return db.query('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[actor,target,mode,role,active,caps,types,reason]);
}
await check('Admin retains full operational access',async()=>{
 await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[adminUser,'admin@example.invalid']);
 await db.query("insert into staff_roles(user_id,display_name,role)values($1,'Admin','admin')",[adminUser]);
 const row=(await db.query("select private.staff_can($1,'training') t,private.staff_can($1,'access') a,private.staff_can($1,'subscriptions') s,private.staff_can($1,'catalog') c,private.staff_can_train($1,$2) e",[adminUser,type])).rows[0];
 assert.deepEqual(row,{t:true,a:true,s:true,c:true,e:true});
 await rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[adminUser,trainer,'role','owner',true,null,null,'Attempted role promotion by operational Admin'],/Owner permission/);
});
await check('existing training authority and imported data are preserved',async()=>{
 assert.equal((await db.query('select training_certification_type_ids from staff_roles where user_id=$1',[trainer])).rows[0].training_certification_type_ids,null);
 assert.equal((await db.query('select private.staff_can_train($1,$2) ok',[trainer,otherType])).rows[0].ok,true);
});
await check('Owner assigns tasks and training types with a recorded review',async()=>{
 await staffChange(owner,trainer,'responsibilities',null,null,['training','catalog'],[type]);
 const row=(await db.query('select capabilities,training_certification_type_ids from staff_roles where user_id=$1',[trainer])).rows[0];
 assert.deepEqual(row.capabilities,['catalog','training']);assert.deepEqual(row.training_certification_type_ids,[type]);
 assert.equal((await db.query("select count(*)::int n from audit_log where action='staff_responsibilities_updated' and metadata->>'reason' like 'Documented%' ")).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from people')).rows[0].n,2);
});
await check('role or activation changes preserve focused duties and equipment scope',async()=>{
 await staffChange(owner,trainer,'responsibilities',null,null,['training','catalog'],[type]);
 await staffChange(owner,trainer,'role','viewer',false);
 let row=(await db.query('select capabilities,training_certification_type_ids from staff_roles where user_id=$1',[trainer])).rows[0];
 assert.deepEqual(row.capabilities,['catalog','training']);assert.deepEqual(row.training_certification_type_ids,[type]);
 assert.equal((await db.query('select private.staff_can_train($1,$2) ok',[trainer,type])).rows[0].ok,false);
 await staffChange(owner,trainer,'role','trainer',true);
 row=(await db.query('select private.staff_can_train($1,$2) own,private.staff_can_train($1,$3) other',[trainer,type,otherType])).rows[0];
 assert.deepEqual(row,{own:true,other:false});
});
await check('changing focused role labels does not silently grant training',async()=>{
 await staffChange(owner,access,'role','trainer',true);
 const row=(await db.query("select private.staff_can($1,'training') t,private.staff_can($1,'access') a",[access])).rows[0];
 assert.deepEqual(row,{t:false,a:true});
});
await check('demoting a broad role requires a fresh focused assignment',async()=>{
 await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[adminUser,'admin@example.invalid']);
 await db.query("insert into staff_roles(user_id,display_name,role)values($1,'Admin','admin')",[adminUser]);
 await staffChange(owner,adminUser,'role','trainer',true);
 assert.equal((await db.query('select private.staff_can_train($1,$2) ok',[adminUser,type])).rows[0].ok,false);
});
await check('the final active Owner cannot be demoted',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,owner,'role','admin',true,null,null,'Documented proposed change'],/final active owner/));
await check('the final active Owner cannot be deactivated',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,owner,'role','owner',false,null,null,'Documented proposed change'],/final active owner/));
await check('Owner transfer leaves another active Owner in control',async()=>{
 await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[secondOwner,'second-owner@example.invalid']);
 await db.query("insert into staff_roles(user_id,display_name,role)values($1,'Second owner','owner')",[secondOwner]);
 await staffChange(owner,owner,'role','admin',true);
 assert.equal((await db.query("select count(*)::int n from staff_roles where role='owner' and active")).rows[0].n,1);
 await rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[secondOwner,secondOwner,'role','admin',true,null,null,'Documented proposed change'],/final active owner/);
});
await check('focused staff cannot grant their own permissions',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[trainer,trainer,'responsibilities',null,null,['training','access'],null,'Attempted self assignment'],/Owner permission/));
await check('deactivated Owner cannot assign staff tasks',async()=>{
 await db.query('update staff_roles set active=false where user_id=$1',[owner]);
 await rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,trainer,'responsibilities',null,null,['training'],[type],'Documented review'],/Owner permission/);
});
await check('trusted staff access RPC cannot be called by signed-in clients',async()=>{
 await db.exec('set local role authenticated');
 await rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,trainer,'role','owner',true,null,null,'Forged actor identity'],/permission denied/);
});
await check('trainer cannot record a pass for an unassigned equipment type',async()=>{
 await staffChange(owner,trainer,'responsibilities',null,null,['training'],[otherType]);
 await rejects('select record_manual_training($1,$2,$3,current_date,$4,$5,$6)',[trainer,person,type,'Trainer','Synthetic practical assessment','passed'],/Training permission/);
});
await check('QR creation cannot bypass equipment training scope',async()=>{
 await staffChange(owner,trainer,'responsibilities',null,null,['training'],[otherType]);
 await rejects("insert into training_sessions(token_hash,quiz_id,quiz_version,certification_type_id,trainer_user_id,trainer_name,expires_at,capacity)values('unassigned',$1,1,$2,$3,'Trainer',now()+interval '1 hour',5)",[quiz,type,trainer],/Training permission/);
});
await check('existing QR rejects new admissions when equipment authority is removed',async()=>{
 await staffChange(owner,trainer,'responsibilities',null,null,['training'],[otherType]);
 await rejects("select start_training_session_attempt($1,'sessionhash','attempt-hash')",[student],/permission/);
});
await check('loss of trainer authority keeps a score but cannot issue a new certificate',async()=>{
 await join();await staffChange(owner,trainer,'responsibilities',null,null,['training'],[otherType]);
 const result=(await db.query("select submit_quiz_attempt('attempt-hash',$1) result",[JSON.stringify(answers)])).rows[0].result;
 assert.equal(result.passed,true);assert.equal(result.score,20);assert.equal(result.certificationNames.length,0);
 assert.equal((await db.query('select count(*)::int n from certifications')).rows[0].n,0);
});
await check('equipment scope changes do not revoke already-issued certificates',async()=>{
 await join();await db.query("select submit_quiz_attempt('attempt-hash',$1)",[JSON.stringify(answers)]);
 await staffChange(owner,trainer,'responsibilities',null,null,['training'],[otherType]);
 assert.equal((await db.query("select count(*)::int n from certifications where person_id=$1 and status='active'",[person])).rows[0].n,1);
});
await check('training assignment needs equipment scope or explicit general authority',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,trainer,'responsibilities',null,null,['training'],[],'Documented eligibility review'],/at least one/));
await check('responsibility changes require meaningful review evidence',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,trainer,'responsibilities',null,null,['training'],[type],'ok'],/review note/));
await check('staff access does not accept invented duties',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,trainer,'responsibilities',null,null,['staff_management'],null,'Documented eligibility review'],/Unknown capability/));
await check('staff access does not accept missing certification types',()=>rejects('select update_staff_access($1,$2,$3,$4,$5,$6,$7,$8)',[owner,trainer,'responsibilities',null,null,['training'],[uid(9999)],'Documented eligibility review'],/active equipment/));
// Calendar upgrade tests use the actual SQL queue and synthetic reservations.
async function calendarBooking(mapped=true) {
  if(mapped)await db.query("update equipment set google_calendar_id='synthetic-calendar' where id=$1",[machine]);
  else await db.query('update equipment set google_calendar_id=null where id=$1',[machine]);
  return (await db.query(`insert into bookings(booking_reference,person_id,equipment_id,starts_at,ends_at,contact_name,contact_email,contact_phone)
    values('KEC-CALENDAR-TEST',$1,$2,'2030-01-07T04:15:00Z','2030-01-07T05:15:00Z','Synthetic student','student@example.invalid','synthetic') returning id`,[person,machine])).rows[0].id;
}
const ambassador=uid(60),newAccount=uid(61),adminActor=uid(62);
await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'ambassador@example.invalid',now()),($2,'new-profile@example.invalid',now()),($3,'admin@example.invalid',now())",[ambassador,newAccount,adminActor]);
await db.query("insert into staff_roles(user_id,display_name,role,capabilities,training_certification_type_ids)values($1,'MS Ambassador','ambassador','{}','{}'),($2,'Admin','admin',null,null)",[ambassador,adminActor]);
await check('MS Ambassador starts without training or stock-edit permissions',async()=>{const result=(await db.query("select private.staff_can($1,'training') t,private.staff_can($1,'catalog') c",[ambassador])).rows[0];assert.deepEqual(result,{t:false,c:false});});
await check('confirmed registration creates only an unverified personal record',async()=>{const pid=(await db.query("select complete_account_profile($1,'New student','kec_student','KEC-NEW','9800000000','KEC') id",[newAccount])).rows[0].id;const p=(await db.query('select * from people where id=$1',[pid])).rows[0];assert.equal(p.safety_training_status,'unknown');assert.equal(p.waiver_status,'unknown');assert.equal(p.minor_status,'unknown');assert.equal(p.migration_review_required,true);assert.equal((await db.query('select count(*)::int n from certifications where person_id=$1',[pid])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from staff_roles where user_id=$1',[newAccount])).rows[0].n,0);});
await check('profile registration cannot overwrite an existing trainee record',async()=>{const before=(await db.query('select * from people where id=$1',[person])).rows[0];const pid=(await db.query("select complete_account_profile($1,'Changed name','business_external','','','') id",[student])).rows[0].id;assert.equal(pid,person);assert.deepEqual((await db.query('select * from people where id=$1',[person])).rows[0],before);});
await check('profile retries link one person without duplicate records',async()=>{const first=(await db.query("select complete_account_profile($1,'New student','kec_student','ROLL','980','KEC') id",[newAccount])).rows[0].id;assert.equal((await db.query("select complete_account_profile($1,'Other text','kec_staff','','980','KEC') id",[newAccount])).rows[0].id,first);assert.equal((await db.query("select count(*)::int n from people where email='new-profile@example.invalid'")).rows[0].n,1);});
await check('unconfirmed registration cannot create or claim a profile',()=>rejects("select complete_account_profile($1,'New student','kec_student','ROLL','980','KEC')",[unconfirmed],/Confirm your email/));
await check('self-profile RPC is inaccessible to browser clients',async()=>{await db.exec('set local role authenticated');await rejects("select complete_account_profile($1,'New student','kec_student','ROLL','980','KEC')",[newAccount],/permission denied/);});
await check('registration rejects unknown categories and missing required roll',()=>rejects("select complete_account_profile($1,'New student','kec_student','','980','KEC')",[newAccount],/roll number/));
await check('Admin cannot archive equipment through the trusted RPC',async()=>{await rejects("select admin_save_equipment($1,$2)",[adminActor,JSON.stringify({id:machine,slug:'existing-equipment',displayName:'Equipment',status:'inactive'})],/Only an Owner/);});
await check('Admin cannot archive a quiz through the trusted RPC',()=>rejects("select admin_replace_quiz($1,$2,$3)",[adminActor,quiz,JSON.stringify({active:false,questions:[{}],passMark:1})],/Only an Owner/));
await check('permanent deletion cannot erase people or audit evidence',()=>rejects('delete from people where id=$1',[person],/archived by an Owner/));
await check('direct Admin archival is rejected before changing the person',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[adminActor]);await rejects('update people set active=false where id=$1',[person],/Only an Owner/);});
await check('Owner archival retains records and audit evidence',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);await db.query('update people set active=false where id=$1',[person]);assert.equal((await db.query('select active from people where id=$1',[person])).rows[0].active,false);assert.ok((await db.query("select count(*)::int n from audit_log where target_id=$1",[person])).rows[0].n>0);});
await check('password-only Owner retains operational access even with an existing authenticator',async()=>{await db.query("insert into auth.mfa_factors(id,user_id,status)values($1,$2,'verified')",[uid(63),owner]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({aal:'aal1'})]);assert.equal((await db.query("select private.has_staff_rank('owner') allowed")).rows[0].allowed,true);});
await check('verified AAL2 staff retains the original Owner controls',async()=>{await db.query("insert into auth.mfa_factors(id,user_id,status)values($1,$2,'verified')",[uid(63),owner]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({aal:'aal2'})]);assert.equal((await db.query("select private.has_staff_rank('owner') allowed")).rows[0].allowed,true);});
await check('password-only session cannot activate an inactive Owner',async()=>{await db.query("update staff_roles set active=false where user_id=$1",[owner]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({aal:'aal1'})]);assert.equal((await db.query("select private.has_staff_rank('owner') allowed")).rows[0].allowed,false);});
await check('password-only participant cannot become staff',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[student]);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({aal:'aal1'})]);assert.equal((await db.query("select private.has_staff_rank('viewer') allowed")).rows[0].allowed,false);});
await check('password-only scoped trainer does not gain Owner access',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[trainer]);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({aal:'aal1'})]);assert.equal((await db.query("select private.has_staff_rank('owner') allowed")).rows[0].allowed,false);assert.equal((await db.query("select private.staff_can($1,'training') allowed",[trainer])).rows[0].allowed,true);});

const requestTraining=()=>db.query("select request_account_training($1,$2,'9800000000','Monday after two pm','Beginner training request') id",[student,type]);
await check('unverified prerequisites do not prevent requesting a future training session',async()=>{await db.query("update people set safety_training_status='unknown',waiver_status='unknown',minor_status='unknown' where id=$1",[person]);const rid=(await requestTraining()).rows[0].id;assert.equal((await db.query('select status from training_requests where id=$1',[rid])).rows[0].status,'pending');assert.equal((await db.query('select count(*)::int n from certifications where person_id=$1',[person])).rows[0].n,0);});
await check('duplicate open training requests are rejected',async()=>{await requestTraining();await rejects("select request_account_training($1,$2,'9800000000','Monday after two pm','Another request')",[student,type],/already have an open request/);});
await check('training requests require a contact number and availability',()=>rejects("select request_account_training($1,$2,'980','short','')",[student,type],/contact number/));
await check('a scoped trainer cannot schedule outside equipment authority',async()=>{const rid=(await requestTraining()).rows[0].id;await db.query("update staff_roles set training_certification_type_ids='{}' where user_id=$1",[trainer]);await rejects("select update_training_request($1,$2,'scheduled',now()+interval '2 days','Meet the trainer at the Makerspace desk')",[trainer,rid],/assigned training authority/);});
await check('scheduling posts a session plan without issuing a certification',async()=>{const rid=(await requestTraining()).rows[0].id;await db.query("select update_training_request($1,$2,'scheduled',now()+interval '2 days','Meet the trainer at the Makerspace desk')",[trainer,rid]);const row=(await db.query('select * from training_requests where id=$1',[rid])).rows[0];assert.equal(row.status,'scheduled');assert.equal(row.handled_by,trainer);assert.equal((await db.query('select count(*)::int n from certifications where person_id=$1',[person])).rows[0].n,0);});
await check('future training sessions cannot be marked completed',async()=>{const rid=(await requestTraining()).rows[0].id;await db.query("select update_training_request($1,$2,'scheduled',now()+interval '2 days','Meet the trainer at the Makerspace desk')",[trainer,rid]);await rejects("select update_training_request($1,$2,'completed',null,'Training session was completed by this participant')",[trainer,rid],/after its start time/);});
await check('completed training appointments do not grant equipment access',async()=>{const rid=(await requestTraining()).rows[0].id;await db.query("update training_requests set status='scheduled',scheduled_at=now()-interval '1 hour' where id=$1",[rid]);await db.query("select update_training_request($1,$2,'completed',null,'Training session was completed by this participant')",[trainer,rid]);assert.equal((await db.query('select count(*)::int n from certifications where person_id=$1',[person])).rows[0].n,0);});
await check('a student cannot cancel another person’s training request',async()=>{const rid=(await requestTraining()).rows[0].id;await rejects('select cancel_account_training_request($1,$2)',[other,rid],/only your own/);});
await check('own training cancellation retains request and audit history',async()=>{const rid=(await requestTraining()).rows[0].id;await db.query('select cancel_account_training_request($1,$2)',[student,rid]);assert.equal((await db.query('select status from training_requests where id=$1',[rid])).rows[0].status,'cancelled');});
await check('minor requests go through supervised outreach via the help desk',async()=>{await db.query("update people set minor_status='minor' where id=$1",[person]);await rejects("select request_account_training($1,$2,'9800000000','Monday after two pm','')",[student,type],/supervised outreach/);});
await check('training-request directory cannot be read through client REST',async()=>{await db.exec('set local role authenticated');await rejects('select * from training_requests',[],/permission denied/);});

const preferred=async(user=student)=> (await db.query("select request_training_with_preference($1,$2,'9800000000','2030-01-07','10:00','12:00','Wednesday also possible','Beginner project') id",[user,type])).rows[0].id;
const appoint=(rid,{actor=owner,status='scheduled',start='2030-01-07T10:00:00+05:45',end='2030-01-07T11:00:00+05:45',assigned=trainer,confirmed=false}={})=>db.query('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,$8)',[actor,rid,status,start,end,assigned,'Meet in the Makerspace for supervised training.',confirmed]);
const queue=async(actor=owner,audience='all',search='')=>(await db.query("select list_training_request_queue($1,$2,$3,'all',null,1) result",[actor,search,audience])).rows[0].result;
await check('structured preferred date and window are retained without granting access',async()=>{const rid=await preferred();const r=(await db.query('select * from training_requests where id=$1',[rid])).rows[0];assert.equal(r.preferred_start,'10:00:00');assert.match(r.availability,/2030-01-07 10:00–12:00 Nepal/);assert.equal(r.status,'pending');assert.equal((await db.query('select count(*)::int n from certifications')).rows[0].n,0);});
await check('past preferred time cannot create a request',()=>rejects("select request_training_with_preference($1,$2,'9800000000','2020-01-07','10:00','12:00','','')",[student,type],/future/));
await check('reversed preferred window cannot create a request',()=>rejects("select request_training_with_preference($1,$2,'9800000000','2030-01-07','12:00','10:00','','')",[student,type],/valid start/));
await check('Admin accepts a requested time and assigns an authorized trainer',async()=>{const rid=await preferred();await appoint(rid,{actor:adminActor});const r=(await db.query('select * from training_requests where id=$1',[rid])).rows[0];assert.equal(r.assigned_trainer_id,trainer);assert.equal(r.status,'scheduled');assert.equal(new Date(r.scheduled_end_at).toISOString(),'2030-01-07T05:15:00.000Z');assert.equal((await db.query("select count(*)::int n from audit_log where action='training_appointment_updated'")).rows[0].n,1);});
await check('a changed time requires participant contact confirmation',async()=>{const rid=await preferred();await rejects('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,false)',[owner,rid,'scheduled','2030-01-08T10:00:00+05:45','2030-01-08T11:00:00+05:45',trainer,'Alternative time agreed later'],/Contact the participant/);});
await check('confirmed alternative time is posted and recorded',async()=>{const rid=await preferred();await appoint(rid,{start:'2030-01-08T10:00:00+05:45',end:'2030-01-08T11:00:00+05:45',confirmed:true});assert.ok((await db.query('select alternate_time_confirmed_at from training_requests where id=$1',[rid])).rows[0].alternate_time_confirmed_at);});
await check('rescheduling within the original window still requires contact',async()=>{const rid=await preferred();await appoint(rid);await rejects('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,false)',[owner,rid,'scheduled','2030-01-07T10:30:00+05:45','2030-01-07T11:30:00+05:45',trainer,'Adjust the accepted session'],/Contact the participant/);});
await check('trainer cannot schedule even their own assigned appointment',async()=>{const rid=await preferred();await appoint(rid);await rejects('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,false)',[trainer,rid,'scheduled','2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45',trainer,'Trainer tried to reschedule'],/Admins schedule/);});
await check('inactive trainer cannot receive an appointment',async()=>{const rid=await preferred();await db.query('update staff_roles set active=false where user_id=$1',[trainer]);await rejects('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,false)',[owner,rid,'scheduled','2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45',trainer,'Assign an inactive trainer'],/active trainer/);});
await check('trainer lacking equipment scope cannot receive an appointment',async()=>{const rid=await preferred();await db.query('update staff_roles set training_certification_type_ids=$1 where user_id=$2',[[otherType],trainer]);await rejects('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,false)',[owner,rid,'scheduled','2030-01-07T10:00:00+05:45','2030-01-07T11:00:00+05:45',trainer,'Assign the wrong equipment trainer'],/active trainer/);});
await check('trainers see only assigned accepted sessions and cannot browse pending clients',async()=>{const rid=await preferred();assert.equal((await queue(trainer)).total,0);await appoint(rid);const r=await queue(trainer);assert.equal(r.total,1);assert.equal(r.rows[0].assigned_trainer.display_name,'Trainer');await appoint(rid,{assigned:owner});assert.equal((await queue(trainer)).total,0);});
await check('external queue uses trusted person category and searches organization',async()=>{await db.query("update people set category='business_external',organization='Acme Lab' where id=$1",[person]);await preferred();assert.equal((await queue(owner,'external','acme')).total,1);assert.equal((await queue(owner,'kec')).total,0);assert.equal((await queue(owner,'external','no match')).total,0);});
await check('search treats wildcard characters as literal text',async()=>{await preferred();assert.equal((await queue(owner,'all','%')).total,0);});
await check('same trainer cannot be booked for overlapping different times',async()=>{const a=await preferred(),b=await preferred(other);await appoint(a);await rejects('select update_training_appointment($1,$2,$3,$4,$5,$6,$7,false)',[owner,b,'scheduled','2030-01-07T10:30:00+05:45','2030-01-07T11:30:00+05:45',trainer,'An overlapping separate session'],/overlapping session/);});
await check('participants can share the same equipment group session',async()=>{const a=await preferred(),b=await preferred(other);await appoint(a);await appoint(b);assert.equal((await queue(trainer)).total,2);});
await check('assigned trainer cannot mark a future session completed',async()=>{const rid=await preferred();await appoint(rid);await rejects('select update_training_appointment($1,$2,$3,null,null,null,$4,false)',[trainer,rid,'completed','Premature completion attempt'],/scheduled end/);});
await check('only assigned trainer can complete an ended session and no certificate is issued',async()=>{const rid=await preferred();await appoint(rid);await db.query("update training_requests set scheduled_at=now()-interval '2 hours',scheduled_end_at=now()-interval '1 hour' where id=$1",[rid]);await appoint(rid,{actor:trainer,status:'completed',start:null,end:null,assigned:null});assert.equal((await db.query('select status,assigned_trainer_id from training_requests where id=$1',[rid])).rows[0].status,'completed');assert.equal((await db.query('select count(*)::int n from certifications')).rows[0].n,0);});
await check('new training queue RPC cannot be called by browser clients',async()=>{await db.exec('set local role authenticated');await rejects("select list_training_request_queue($1)",[owner],/permission denied/);});
await check('QR custom session label preserves the assessment and admission rules',async()=>{await db.query("update training_sessions set display_name='External Friday training' where id=$1",[session]);await join();assert.equal((await db.query('select display_name from training_sessions where id=$1',[session])).rows[0].display_name,'External Friday training');assert.equal((await db.query('select max_score from quiz_attempts')).rows[0].max_score,20);});

await check('attempt directory searches retained participant email without answer keys',async()=>{await join();const result=(await db.query("select search_training_attempts($1,'student@example.invalid','all',1) result",[owner])).rows[0].result;assert.equal(result.total,1);assert.equal(result.rows[0].people.email,'student@example.invalid');assert.equal(result.rows[0].answers,undefined);});
await check('attempt search respects pass/fail filter and literal search characters',async()=>{await join();await db.query("select submit_quiz_attempt('attempt-hash',$1)",[JSON.stringify(answers)]);assert.equal((await db.query("select search_training_attempts($1,'','passed',1) result",[owner])).rows[0].result.total,1);assert.equal((await db.query("select search_training_attempts($1,'','failed',1) result",[owner])).rows[0].result.total,0);assert.equal((await db.query("select search_training_attempts($1,'%','all',1) result",[owner])).rows[0].result.total,0);});
await check('focused trainers cannot browse the broad attempt directory',()=>rejects("select search_training_attempts($1,'','all',1)",[trainer],/Admin permission/));
await check('attempt search RPC is inaccessible to browser clients',async()=>{await db.exec('set local role authenticated');await rejects("select search_training_attempts($1)",[owner],/permission denied/);});

await check('request queue paginates 51 clients without duplicates or omissions',async()=>{for(let i=0;i<51;i++){const id=uid(700+i),pid=uid(800+i),email=`page-${i}@example.invalid`;await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[id,email]);await db.query("insert into people(id,email,full_name,category,organization)values($1,$2,$3,'business_external','Paging Lab')",[pid,email,`Client ${i}`]);await db.query("insert into training_requests(user_id,person_id,certification_type_id,contact_phone,availability)values($1,$2,$3,'9800000000','Monday afternoon')",[id,pid,type]);}const a=(await db.query("select list_training_request_queue($1,'Paging Lab','external','open',null,1) r",[owner])).rows[0].r,b=(await db.query("select list_training_request_queue($1,'Paging Lab','external','open',null,2) r",[owner])).rows[0].r;assert.equal(a.total,51);assert.equal(a.rows.length,50);assert.equal(b.rows.length,1);assert.equal(new Set([...a.rows,...b.rows].map(row=>row.id)).size,51);});
await check('new booking queues one calendar upsert automatically',async()=>{
  await calendarBooking();assert.equal((await db.query('select count(*)::int n from calendar_sync_jobs')).rows[0].n,1);
});
await check('calendar status writeback does not recursively requeue',async()=>{
  const id=await calendarBooking();await db.exec("update calendar_sync_jobs set status='synced'");
  await db.query("update bookings set calendar_sync_status='synced',calendar_event_id='event123' where id=$1",[id]);
  assert.equal((await db.query('select status from calendar_sync_jobs')).rows[0].status,'synced');
});
await check('booking changes requeue previously synced events',async()=>{
  const id=await calendarBooking();await db.exec("update calendar_sync_jobs set status='synced'");
  await db.query("update bookings set contact_name='Changed synthetic name' where id=$1",[id]);
  assert.equal((await db.query('select status from calendar_sync_jobs')).rows[0].status,'pending');
});
await check('only one operation per booking can be claimed at once',async()=>{
  const id=await calendarBooking();await db.query("insert into calendar_sync_jobs(booking_id,operation)values($1,'cancel')",[id]);
  assert.equal((await db.query('select * from claim_calendar_sync_jobs(20)')).rows.length,1);
  assert.equal((await db.query('select * from claim_calendar_sync_jobs(20)')).rows.length,0);
});
await check('abandoned calendar work becomes claimable after ten minutes',async()=>{
  await calendarBooking();await db.exec("update calendar_sync_jobs set status='processing',locked_at=now()-interval '11 minutes'");
  assert.equal((await db.query('select * from claim_calendar_sync_jobs(20)')).rows.length,1);
});
await check('disabled-integration jobs and due failures can be recovered',async()=>{
  await calendarBooking();await db.exec("update calendar_sync_jobs set status='not_configured'");
  assert.equal((await db.query('select * from claim_calendar_sync_jobs(20)')).rows.length,1);
  await db.exec("update calendar_sync_jobs set status='failed',next_attempt_at=now()+interval '1 hour'");
  assert.equal((await db.query('select * from claim_calendar_sync_jobs(20)')).rows.length,0);
  await db.exec("update calendar_sync_jobs set next_attempt_at=now()-interval '1 minute'");
  assert.equal((await db.query('select * from claim_calendar_sync_jobs(20)')).rows.length,1);
});
await check('first calendar mapping picks up already-created future bookings',async()=>{
  await calendarBooking(false);assert.equal((await db.query('select count(*)::int n from calendar_sync_jobs')).rows[0].n,0);
  await db.query("update equipment set google_calendar_id='synthetic-calendar' where id=$1",[machine]);
  assert.equal((await db.query('select count(*)::int n from calendar_sync_jobs')).rows[0].n,1);
});
await check('authenticated clients cannot run the calendar worker RPC',async()=>{
  await db.exec('set local role authenticated');await rejects('select * from claim_calendar_sync_jobs(20)',[],/permission denied/);
});
console.log(`${count} upgrade checks passed. Real PostgreSQL engine; synthetic Auth identities. Hosted Auth, SMTP and external calendars are not exercised.`);
await db.close();
