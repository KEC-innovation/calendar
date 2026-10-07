import { emptyProfile, ProfileFields } from './ProfileFields';
import { workspaceCache } from '../../lib/workspaceCache';
import { MfaGate } from './MfaSecurity';
import { useEffect,useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { Brand } from '../../components/Brand';
import { navigate } from '../../lib/hashRouter';
import { message,portal,recoveryUrl } from './client';
export function Account({children,forcePassword=false,initialMode='login',staffMode=false}:{children:React.ReactNode;forcePassword?:boolean;initialMode?:'login'|'signup';staffMode?:boolean}){
 const [profile,setProfile]=useState(emptyProfile);const [existing,setExisting]=useState(false);
 const [ready,setReady]=useState(false);const [logged,setLogged]=useState(false);const [change,setChange]=useState(forcePassword);
 const [mode,setMode]=useState<'login'|'signup'|'forgot'>(initialMode);const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [error,setError]=useState('');
 useEffect(()=>{let live=true;const client=getSupabase();
 const refresh=async()=>{const {data}=await client.auth.getSession();if(!live)return;setLogged(!!data.session);if(data.session){try{const state=await portal<{passwordChangeRequired:boolean}>('account.status');if(live&&state.passwordChangeRequired)setChange(true);}catch(cause){if(live)setError(message(cause));}}if(live)setReady(true);};
 void refresh();const {data:listener}=client.auth.onAuthStateChange((event,session)=>{if(live){setLogged(!!session);if(event==='SIGNED_OUT'||event==='SIGNED_IN')workspaceCache.clear();if(event==='PASSWORD_RECOVERY')setChange(true);}});
 return()=>{live=false;listener.subscription.unsubscribe();};},[]);
 async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setNotice('');try{const client=getSupabase();
 if(change&&logged){if(password!==confirm)throw new Error('The passwords do not match.');await portal('password.change',{password});setChange(false);const clean=new URL(window.location.href);clean.search='';window.history.replaceState(null,'',clean);navigate(sessionStorage.getItem('kec-next-route')||'/account');sessionStorage.removeItem('kec-next-route');setNotice('Password saved.');}
 else if(mode==='forgot'){const {error:cause}=await client.auth.resetPasswordForEmail(email,{redirectTo:recoveryUrl()});if(cause)throw cause;setNotice('If this account exists, a reset link will arrive by email. Check spam too.');}
 else if(mode==='signup'){if(password!==confirm)throw new Error('The passwords do not match.');const redirect=new URL(window.location.href);redirect.search='?account=confirm';redirect.hash='';const {error:cause}=await client.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:redirect.toString(),data:existing?{}:{registration_profile:profile}}});if(cause && !['user_already_exists','email_exists'].includes(cause.code||''))throw cause;setNotice('Check your email for the next step. If you already have an account, sign in or use Forgot password. Existing training links after your email is confirmed.');}
 else{const {error:cause}=await client.auth.signInWithPassword({email,password});if(cause)throw cause;const state=await portal<{passwordChangeRequired:boolean}>('account.status');setChange(state.passwordChangeRequired);setLogged(true);}
 setPassword('');setConfirm('');}catch(cause){setError(message(cause));}finally{setBusy(false);}}
 if(!ready)return <main className="simple-shell">Checking your account…</main>;
 if(logged&&!change)return <MfaGate required={staffMode}>{children}</MfaGate>;
 const content=<main className="simple-shell auth-shell"><header><Brand/><a href="#/">Home</a></header><section className={`simple-card auth-card ${mode==='signup'&&!change?'auth-card--register':''}`}><p className="eyebrow">Your Makerspace account</p><h1>{change?'Set your password':mode==='forgot'?'Forgot password':mode==='signup'?'Create your account':'Sign in to KEC Makerspace'}</h1><p>Register to request training and book equipment. Existing trainees should use the email on their training record.</p>{error&&<p className="alert alert--error" role="alert">{error}</p>}{notice&&<p className="alert" role="status">{notice}</p>}<form className="account-form" onSubmit={event=>void submit(event)}>
 {mode==='signup'&&!change&&<><label className="check-line"><input type="checkbox" checked={existing} onChange={e=>setExisting(e.target.checked)}/>Already trained? Link my existing Makerspace record</label><p>{existing?'Use the email on your training record. We will retain your existing details and passes.':'Enter your details to register. Staff verify safety, waiver and equipment training separately.'}</p>{!existing&&<ProfileFields value={profile} onChange={setProfile}/>}</>}
 {!(change&&logged)&&<label className="field">Email<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>}
 {(mode!=='forgot'||change)&&<label className="field">Password<input type="password" minLength={change||mode==='signup'?12:1} required autoComplete={change||mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
 {((change&&logged)||mode==='signup')&&<label className="field">Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
 <button className="button button--primary" disabled={busy}>{busy?'Please wait…':change&&logged?'Save password':mode==='forgot'?'Send reset email':mode==='signup'?'Create account':'Sign in'}</button></form>
 {!change&&<div className="portal-actions">{mode!=='login'&&<button className="text-button" onClick={()=>{setMode('login');setNotice('');setError('');}}>Already have an account? Sign in</button>}{mode!=='signup'&&<button className="text-button" onClick={()=>{setMode('signup');setNotice('');setError('');}}>Create account / first sign in</button>}<button className="text-button" onClick={()=>setMode('forgot')}>Forgot password</button></div>}
 {change&&!logged&&<p>Open the latest password email link. If it expired, <button className="text-button" onClick={()=>{setChange(false);setMode('forgot');}}>request a new one</button>.</p>}
 <div className="portal-actions"><a href="#/">Home</a><a href="#/policies">Policies & tracking</a><a href="#/catalog">Equipment & materials</a><a href="#/staff/login">Staff sign in</a></div></section></main>;
 return logged?<MfaGate>{content}</MfaGate>:content;
}
