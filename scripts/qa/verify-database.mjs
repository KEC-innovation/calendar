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
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
set search_path=public,extensions;`);
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
// Calendar upgrade tests use the actual SQL queue and synthetic reservations.
async function calendarBooking(mapped=true) {
  if(mapped)await db.query("update equipment set google_calendar_id='synthetic-calendar' where id=$1",[machine]);
  else await db.query('update equipment set google_calendar_id=null where id=$1',[machine]);
  return (await db.query(`insert into bookings(booking_reference,person_id,equipment_id,starts_at,ends_at,contact_name,contact_email,contact_phone)
    values('KEC-CALENDAR-TEST',$1,$2,'2030-01-07T04:15:00Z','2030-01-07T05:15:00Z','Synthetic student','student@example.invalid','synthetic') returning id`,[person,machine])).rows[0].id;
}
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
