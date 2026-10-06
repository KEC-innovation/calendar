import { adminClient, requireStaff, userClient } from '../_shared/supabase.ts';
import { requireAccount, staffCan, staffCanTrain, capabilityNames, appUrl } from '../_shared/accounts.ts';
import { handle,HttpError,json,readJson,text,requiredText,requireUuid } from '../_shared/http.ts';
import { consumeRateLimit,randomToken,sha256,safeEmail } from '../_shared/security.ts';
import { writeAudit } from '../_shared/audit.ts';
function checked(result:any) { if(result.error) throw new HttpError(400,result.error.message,'OPERATION_FAILED'); return result.data; }
const personFields='id,full_name,email,roll_number,category,organization,active,booking_privilege_active,safety_training_status,waiver_status,minor_status,migration_review_required,priority_rank';
Deno.serve(request=>handle(request,async()=>{
 const body=await readJson(request,40000); const action=text(body.action,50);const admin=adminClient();
 if(action==='catalog') {
  const [materials,plans,equipment]=await Promise.all([
   admin.from('material_catalog').select('id,name,kind,unit,stock_quantity,market_price_npr,description,updated_at').eq('active',true).order('name'),
   admin.from('subscription_plans').select('id,name,pricing_tier,monthly_npr,minimum_months,certification_type_ids').eq('active',true).order('name'),
   admin.from('equipment').select('id,display_name,status,booking_enabled,max_booking_minutes').neq('status','inactive').order('display_name')]);
  return json(request,{materials:checked(materials),plans:checked(plans),equipment:checked(equipment)});
 }
 const {user,security}=await requireAccount(request,action==='password.change'||action==='account.status');
 await consumeRateLimit(admin,request,`portal-${user.id}`,120,600);
 if(action==='account.status') return json(request,{passwordChangeRequired:security?.password_change_required===true,email:user.email});
 if(action==='password.change') {
  const password=requiredText(body.password,'Password',200);
  if(password.length<12) throw new HttpError(400,'Use at least 12 characters.','WEAK_PASSWORD');
  checked(await userClient(request).auth.updateUser({password}));
  checked(await admin.from('account_security').upsert({user_id:user.id,password_change_required:false,temporary_expires_at:null,updated_at:new Date().toISOString()}));
  return json(request,{ok:true});
 }
 if(action.startsWith('me.')) {
  const pid=checked(await admin.rpc('link_person_account',{p_user:user.id}));
  if(action==='me.dashboard') {
   const result=await Promise.all([
    admin.from('people').select(personFields).eq('id',pid).single(),
    admin.from('certifications').select('id,status,issued_at,source_kind,certification_types(id,display_name)').eq('person_id',pid),
    admin.from('bookings').select('id,booking_reference,starts_at,ends_at,status,late_cancellation,equipment(display_name)').eq('person_id',pid).order('starts_at',{ascending:false}).limit(100),
    admin.from('client_subscriptions').select('id,starts_on,ends_on,status,agreed_total_npr,subscription_plans(name,certification_type_ids),subscription_payments(amount_npr,paid_on,receipt_reference)').eq('person_id',pid).order('starts_on',{ascending:false}),
    admin.from('equipment').select('id,display_name,status,max_booking_minutes,external_allowed,equipment_certification_requirements(certification_type_id)').eq('booking_enabled',true).eq('status','active'),
    admin.from('quiz_attempts').select('id,attempt_reference,status,score,max_score,passed,started_at,quizzes(display_name)').eq('participant_id',pid).order('started_at',{ascending:false}).limit(50)]);
   const [person,certifications,bookings,subscriptions,equipment,attempts]=result.map(checked);
   return json(request,{person,certifications,bookings,subscriptions,equipment,attempts});
  }
  if(action==='me.book') return json(request,checked(await admin.rpc('book_for_account',{p_user:user.id,p_equipment:requireUuid(body.equipmentId,'Equipment'),p_start:requiredText(body.startsAt,'Start',40),p_end:requiredText(body.endsAt,'End',40),p_purpose:text(body.purpose,500)})),201);
  if(action==='me.cancel') return json(request,checked(await admin.rpc('cancel_for_account',{p_user:user.id,p_booking:requireUuid(body.bookingId,'Booking')})));
 }
 if(action==='training.join') {
  const token=randomToken(32);
  checked(await admin.rpc('start_training_session_attempt',{p_user:user.id,p_session_hash:await sha256(requiredText(body.sessionToken,'Training QR',128)),p_attempt_hash:await sha256(token)}));
  return json(request,{attemptToken:token},201);
 }
 const staff=await requireStaff(request);
 const allow=(cap:string)=>{if(!staffCan(staff,cap)) throw new HttpError(403,`Your staff account needs ${cap} permission.`,'PERMISSION_REQUIRED');};
 if(action==='workspace') {
  const caps=capabilityNames.filter(cap=>staffCan(staff,cap));
  const data:any={capabilities:caps,people:[],types:[],quizzes:[],sessions:[],manual:[],plans:[],subscriptions:[],materials:[]};
  if(caps.some(cap=>['access','training','subscriptions'].includes(cap))) {
   // Search and cap directory responses; never return all people to participants.
   const search=text(body.search,100).replace(/[%_,().]/g,'');
   let query=admin.from('people').select(personFields).order('full_name').limit(200);
   if(search) query=query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
   data.people=checked(await query);
   data.types=checked(await admin.from('certification_types').select('id,display_name').eq('active',true).order('display_name'));
  }
  if(caps.includes('training')) {
   data.types=data.types.filter((type:any)=>staffCanTrain(staff,type.id));
   data.quizzes=checked(await admin.from('quizzes').select('id,display_name,active,duration_minutes,pass_mark,question_count,quiz_certification_mappings(certification_type_id)').eq('active',true)).map((quiz:any)=>({...quiz,quiz_certification_mappings:quiz.quiz_certification_mappings.filter((mapping:any)=>staffCanTrain(staff,mapping.certification_type_id))})).filter((quiz:any)=>quiz.quiz_certification_mappings.length);
   let sessionsQuery=admin.from('training_sessions').select('id,expires_at,revoked_at,capacity,trainer_name,quiz_id,certification_type_id,quiz_attempts(id,status,passed)').order('created_at',{ascending:false}).limit(40);
   if(!['owner','admin'].includes(staff.role)) sessionsQuery=sessionsQuery.eq('trainer_user_id',staff.userId);
   data.sessions=checked(await sessionsQuery);
   let manualQuery=admin.from('manual_training_records').select('id,trained_on,trainer_name,outcome,evidence,people(full_name),certification_types(display_name)').order('created_at',{ascending:false}).limit(40);
   if(!['owner','admin'].includes(staff.role)) manualQuery=manualQuery.eq('recorded_by',staff.userId);
   data.manual=checked(await manualQuery);
  }
  if(caps.includes('subscriptions')) {
   data.plans=checked(await admin.from('subscription_plans').select('*').eq('active',true).order('name'));
   data.subscriptions=checked(await admin.from('client_subscriptions').select('*,people(full_name,email),subscription_plans(name),subscription_payments(amount_npr,paid_on,receipt_reference)').order('created_at',{ascending:false}).limit(200));
  }
  if(caps.includes('catalog')) data.materials=checked(await admin.from('material_catalog').select('*').order('name'));
  return json(request,data);
 }
 if(action==='training.open') {
  allow('training');
  const quizId=requireUuid(body.quizId,'Quiz');const typeId=requireUuid(body.certificationTypeId,'Certification');
  if(!staffCanTrain(staff,typeId)) throw new HttpError(403,'This equipment certification is outside your assigned training authority.','PERMISSION_REQUIRED');
  const q=checked(await admin.from('quizzes').select('id,version,active').eq('id',quizId).eq('active',true).single());
  checked(await admin.from('quiz_certification_mappings').select('quiz_id').eq('quiz_id',quizId).eq('certification_type_id',typeId).single());
  const minutes=Number(body.minutes),capacity=Number(body.capacity);
  if(!Number.isInteger(minutes)||minutes<1||minutes>120||!Number.isInteger(capacity)||capacity<1||capacity>200) throw new HttpError(400,'Choose 1–120 minutes and 1–200 participants.','VALIDATION_ERROR');
  const url=appUrl();const token=randomToken(32);const expires=new Date(Date.now()+minutes*60000).toISOString();
  const record=checked(await admin.from('training_sessions').insert({token_hash:await sha256(token),quiz_id:quizId,quiz_version:q.version,certification_type_id:typeId,trainer_user_id:staff.userId,trainer_name:staff.displayName,expires_at:expires,capacity}).select('id').single());
  await writeAudit(admin,staff,'training_qr_opened','training_sessions',record.id,{expires_at:expires,capacity,quiz_id:quizId,certification_type_id:typeId});
  return json(request,{id:record.id,url:`${url}#/training/${token}`,expiresAt:expires});
 }
 if(action==='training.close') {
  allow('training');const id=requireUuid(body.sessionId,'Session');
  const session=checked(await admin.from('training_sessions').select('trainer_user_id').eq('id',id).single());
  if(session.trainer_user_id!==staff.userId&&!['admin','owner'].includes(staff.role)) throw new HttpError(403,'Only the trainer or an administrator can close this session.','PERMISSION_REQUIRED');
  checked(await admin.from('training_sessions').update({revoked_at:new Date().toISOString()}).eq('id',id));
  await writeAudit(admin,staff,'training_qr_closed','training_sessions',id,{});return json(request,{ok:true});
 }
 if(action==='training.manual') {
  allow('training');const id=checked(await admin.rpc('record_manual_training',{p_actor:staff.userId,p_person:requireUuid(body.personId,'Person'),p_type:requireUuid(body.certificationTypeId,'Certification'),p_date:requiredText(body.trainedOn,'Date',10),p_trainer:requiredText(body.trainerName,'Trainer',120),p_evidence:requiredText(body.evidence,'Evidence',1000),p_outcome:requiredText(body.outcome,'Outcome',20)}));
  return json(request,{id},201);
 }
 if(action==='access.create') {
  allow('access');const category=text(body.category,40);
  if(!['kec_student','kec_staff','other_college_student','business_external','member_non_kec','outreach_minor'].includes(category)) throw new HttpError(400,'Choose a valid category.','VALIDATION_ERROR');
  const row=checked(await admin.from('people').insert({email:safeEmail(body.email),full_name:requiredText(body.fullName,'Full name',120),category,roll_number:text(body.rollNumber,80)||null,organization:text(body.organization,160)||null,phone:text(body.phone,40)||null,migration_review_required:true}).select('id').single());
  await writeAudit(admin,staff,'person_added_for_training','people',row.id,{});return json(request,row,201);
 }
 if(action==='access.verify') {
  allow('access');const id=requireUuid(body.personId,'Person');const reason=requiredText(body.reason,'Evidence / review note',1000);
  if(reason.length<10) throw new HttpError(400,'Include a meaningful evidence note.','VALIDATION_ERROR');
  const safety=text(body.safety,20),waiver=text(body.waiver,20),age=text(body.age,20);
  if(!['unknown','verified','revoked'].includes(safety)||!['unknown','verified','revoked'].includes(waiver)||!['unknown','adult','minor'].includes(age)) throw new HttpError(400,'Choose valid record states.','VALIDATION_ERROR');
  checked(await admin.rpc('verify_person_records',{p_actor:staff.userId,p_person:id,p_safety:safety,p_waiver:waiver,p_age:age,p_reason:reason}));return json(request,{ok:true});
 }
 if(action==='accounts.invite') {
  allow('access');await consumeRateLimit(admin,request,`account-invite-${staff.userId}`,10,3600);
  const person=checked(await admin.from('people').select('id,email,full_name').eq('id',requireUuid(body.personId,'Person')).single());
  const email=safeEmail(person.email);const redirect=`${appUrl()}?account=reset`;
  if(body.mode==='temporary') {
   const key=Deno.env.get('BREVO_API_KEY'),sender=Deno.env.get('MAIL_FROM');
   if(!key||!sender) throw new HttpError(503,'Configure Brevo API key and verified MAIL_FROM first.','EMAIL_SETUP_REQUIRED');
   const password=randomToken(24)+'aA7!';
   // Only NEW accounts. Never overwrite an existing user's password.
   const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:person.full_name}});
   if(created.error||!created.data.user) throw new HttpError(400,'Could not create a new account. If it already exists, use password recovery.','ACCOUNT_CREATE_FAILED');
   const uid=created.data.user.id;
   try {
    checked(await admin.from('account_security').insert({user_id:uid,password_change_required:true,temporary_expires_at:null}));
    const sent=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:'KEC Makerspace',email:sender},to:[{email}],subject:'Your KEC Makerspace account',textContent:`Your temporary password is: ${password}\nSign in at ${appUrl()}#/account and set your own password before booking or training. Use Forgot password if you need a new setup link.\nYour existing equipment passes stay on your Makerspace record.`})});
    if(!sent.ok) throw new Error('Email provider rejected the message.');
   } catch(cause) { await admin.auth.admin.deleteUser(uid); throw new HttpError(502,'Account invitation could not be sent; no usable new account was left behind. Check the email provider and retry.','EMAIL_FAILED'); }
  } else {
   const invited=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:redirect});
   if(invited.error) throw new HttpError(400,'Invitation failed. If the account exists, use Forgot password; otherwise check SMTP configuration.','INVITE_FAILED');
  }
  await writeAudit(admin,staff,'account_invitation_sent','people',person.id,{mode:body.mode==='temporary'?'temporary_password':'setup_link'});
  return json(request,{ok:true});
 }
 if(action==='subscriptions.add') {
  allow('subscriptions');const plan=checked(await admin.from('subscription_plans').select('*').eq('id',requireUuid(body.planId,'Plan')).eq('active',true).single());
  const person=checked(await admin.from('people').select('category').eq('id',requireUuid(body.personId,'Person')).single());
  if(['kec_student','kec_staff'].includes(person.category)) throw new HttpError(400,'KEC students and staff have free equipment use; no paid subscription is needed.','FREE_ACCESS');
  const months=Number(body.months);if(!Number.isInteger(months)||months<plan.minimum_months||months>36) throw new HttpError(400,'Choose a subscription term from the plan minimum to 36 months.','VALIDATION_ERROR');
  const start=requiredText(body.startsOn,'Start date',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new HttpError(400,'Invalid date.','VALIDATION_ERROR');
  const id=checked(await admin.rpc('add_client_subscription',{p_actor:staff.userId,p_person:body.personId,p_plan:plan.id,p_start:start,p_months:months,p_note:requiredText(body.note,'Agreement reference',500)}));return json(request,{id});
 }
 if(action==='subscriptions.payment') {
  allow('subscriptions');const amount=Number(body.amount);if(!Number.isFinite(amount)||amount<=0) throw new HttpError(400,'Payment must be greater than zero.','VALIDATION_ERROR');
  const id=requireUuid(body.subscriptionId,'Subscription');
  checked(await admin.from('subscription_payments').insert({subscription_id:id,amount_npr:amount,receipt_reference:requiredText(body.receipt,'Receipt reference',120),paid_on:requiredText(body.paidOn,'Payment date',10),recorded_by:staff.userId}));
  await writeAudit(admin,staff,'subscription_payment_recorded','client_subscriptions',id,{amount});return json(request,{ok:true});
 }
 if(action==='subscriptions.cancel') {
  allow('subscriptions');const id=requireUuid(body.subscriptionId,'Subscription');const reason=requiredText(body.reason,'Reason',500);
  checked(await admin.from('client_subscriptions').update({status:'cancelled',note:reason}).eq('id',id).select('id').single());
  await writeAudit(admin,staff,'subscription_cancelled','client_subscriptions',id,{reason});return json(request,{ok:true});
 }
 if(action==='catalog.save') {
  allow('catalog');const payload={name:requiredText(body.name,'Name',120),kind:requiredText(body.kind,'Kind',20),unit:requiredText(body.unit,'Unit',40),stock_quantity:Number(body.stock),market_price_npr:Number(body.price),description:text(body.description,1000),active:body.active!==false,updated_at:new Date().toISOString()};
  const id=text(body.id,50);const result=checked(id?await admin.from('material_catalog').update(payload).eq('id',requireUuid(id,'Item')).select('id').single():await admin.from('material_catalog').insert(payload).select('id').single());
  await writeAudit(admin,staff,'material_catalog_updated','material_catalog',result.id,{});return json(request,result);
 }
 if(action==='staff.capabilities') {
  if(staff.role!=='owner') throw new HttpError(403,'Owner permission required.','PERMISSION_REQUIRED');
  const uid=requireUuid(body.userId,'Staff account');const caps=body.capabilities;
  if(!Array.isArray(caps)||caps.some(c=>!capabilityNames.includes(c as any))) throw new HttpError(400,'Unknown capability.','VALIDATION_ERROR');
  const scope=body.trainingCertificationTypeIds;
  if(scope!==null && !Array.isArray(scope)) throw new HttpError(400,'Choose equipment training authority.','VALIDATION_ERROR');
  const typeIds=scope===null?null:scope.map(id=>requireUuid(id,'Training certification'));
  checked(await admin.rpc('update_staff_access',{p_actor:staff.userId,p_user:uid,p_mode:'responsibilities',p_capabilities:caps,p_training_type_ids:typeIds,p_reason:requiredText(body.reason,'Eligibility / responsibility review note',1000)}));
  return json(request,{ok:true});
 }
 throw new HttpError(404,'Unknown portal operation.','ACTION_NOT_FOUND');
}));
