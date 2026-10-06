import { useEffect,useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { Brand } from '../../components/Brand';
import { navigate } from '../../lib/hashRouter';
import { message,portal,recoveryUrl } from './client';
export function Account({children,forcePassword=false}:{children:React.ReactNode;forcePassword?:boolean}){
 const [ready,setReady]=useState(false);const [logged,setLogged]=useState(false);const [change,setChange]=useState(forcePassword);
 const [mode,setMode]=useState<'login'|'signup'|'forgot'>('login');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [error,setError]=useState('');
 useEffect(()=>{let live=true;const client=getSupabase();
 const refresh=async()=>{const {data}=await client.auth.getSession();if(!live)return;setLogged(!!data.session);if(data.session){try{const state=await portal<{passwordChangeRequired:boolean}>('account.status');if(live&&state.passwordChangeRequired)setChange(true);}catch(cause){if(live)setError(message(cause));}}if(live)setReady(true);};
 void refresh();const {data:listener}=client.auth.onAuthStateChange((event,session)=>{if(live){setLogged(!!session);if(event==='PASSWORD_RECOVERY')setChange(true);}});
 return()=>{live=false;listener.subscription.unsubscribe();};},[]);
 async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setNotice('');try{const client=getSupabase();
 if(change&&logged){if(password!==confirm)throw new Error('The passwords do not match.');await portal('password.change',{password});setChange(false);const clean=new URL(window.location.href);clean.search='';window.history.replaceState(null,'',clean);navigate(sessionStorage.getItem('kec-next-route')||'/account');sessionStorage.removeItem('kec-next-route');setNotice('Password saved.');}
 else if(mode==='forgot'){const {error:cause}=await client.auth.resetPasswordForEmail(email,{redirectTo:recoveryUrl()});if(cause)throw cause;setNotice('If this account exists, a reset link will arrive by email. Check spam too.');}
 else if(mode==='signup'){const {error:cause}=await client.auth.signUp({email,password,options:{emailRedirectTo:recoveryUrl()}});if(cause)throw cause;setNotice('Check your email to confirm your account. Use the email on your existing training record.');}
 else{const {error:cause}=await client.auth.signInWithPassword({email,password});if(cause)throw cause;const state=await portal<{passwordChangeRequired:boolean}>('account.status');setChange(state.passwordChangeRequired);setLogged(true);}
 setPassword('');setConfirm('');}catch(cause){setError(message(cause));}finally{setBusy(false);}}
 if(!ready)return <main className="simple-shell">Checking your account…</main>;
 if(logged&&!change)return <>{children}</>;
 return <main className="simple-shell"><Brand/><section className="simple-card"><p className="eyebrow">Your Makerspace account</p><h1>{change?'Set your password':mode==='forgot'?'Forgot password':mode==='signup'?'Create your account':'Welcome back'}</h1><p>Use the email on your Makerspace training record. Your passed equipment training carries forward.</p>{error&&<p className="alert alert--error" role="alert">{error}</p>}{notice&&<p className="alert" role="status">{notice}</p>}<form onSubmit={event=>void submit(event)}>
 {!(change&&logged)&&<label className="field">Email<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>}
 {(mode!=='forgot'||change)&&<label className="field">Password<input type="password" minLength={change||mode==='signup'?12:1} required autoComplete={change||mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
 {change&&logged&&<label className="field">Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
 <button className="button button--primary" disabled={busy}>{busy?'Please wait…':change&&logged?'Save password':mode==='forgot'?'Send reset email':mode==='signup'?'Create account':'Sign in'}</button></form>
 {!change&&<div className="portal-actions"><button className="text-button" onClick={()=>{setMode('login');setNotice('');}}>Sign in</button><button className="text-button" onClick={()=>setMode('signup')}>Create account</button><button className="text-button" onClick={()=>setMode('forgot')}>Forgot password</button></div>}
 {change&&!logged&&<p>Open the latest password email link. If it expired, <button className="text-button" onClick={()=>{setChange(false);setMode('forgot');}}>request a new one</button>.</p>}
 <div className="portal-actions"><a href="#/policies">Policies & tracking</a><a href="#/catalog">Equipment & materials</a><a href="#/staff/login">Staff sign in</a></div></section></main>;
}
