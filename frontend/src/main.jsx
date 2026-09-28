import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, UploadCloud, Map, UsersRound, ShieldCheck, Smartphone,
  ScrollText, Gift, Search, Bell, ChevronRight, AlertTriangle, WalletCards,
  Landmark, Shield, TrendingUp, Check, Clock3, FileText, X, ArrowUpRight,
  MoreHorizontal, Plus, LockKeyhole, HeartHandshake, CheckCircle2, Circle,
  UserCheck, RefreshCw, Menu, Loader2
} from 'lucide-react';
import './styles.css';

import mockAssets from '../../shared/mock/assets.json';
import mockProfile from '../../shared/mock/profile.json';
import mockContacts from '../../shared/mock/contacts.json';
import mockStatus from '../../shared/mock/status.json';
import mockTxlog from '../../shared/mock/txlog.json';
import mockClaim from '../../shared/mock/claim_A3.json';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = n => inr.format(Number(n || 0));
const firstName = name => (name || 'Customer').trim().split(/\s+/)[0];
const category = type => ['Savings Account','Current Account','Fixed Deposit','Recurring Deposit'].includes(type) ? 'Bank' : type?.includes('Insurance') ? 'Insurance' : ['EPF','PPF','NPS'].includes(type) ? 'Provident Fund' : 'Investments';

async function get(path, fallback) {
  try {
    const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(1800) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { return fallback; }
}

async function post(path, body) {
  const response = await fetch(`${API}${path}`, { method: 'POST', headers: body instanceof FormData ? {} : {'Content-Type':'application/json'}, body: body instanceof FormData ? body : JSON.stringify(body || {}) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Something went wrong');
  return response.json();
}

const nav = [
  ['dashboard','Overview',LayoutDashboard], ['upload','Upload documents',UploadCloud],
  ['assets','Asset map',Map], ['beneficiaries','Beneficiaries',UsersRound],
  ['contacts','Trusted contacts',HeartHandshake], ['protection','Protection status',ShieldCheck],
  ['confirmation','Contact confirmation',Smartphone], ['transactions','Transaction log',ScrollText],
  ['beneficiary','Beneficiary view',Gift]
];

function App() {
  const [page, setPage] = useState('dashboard');
  const [profile, setProfile] = useState(mockProfile);
  const [assets, setAssets] = useState(mockAssets);
  const [contacts, setContacts] = useState(mockContacts.map((c,i)=>({...c,id:`C${i+1}`,status:i<2?'accepted':'pending'})));
  const [status, setStatus] = useState(mockStatus);
  const [txlog, setTxlog] = useState(mockTxlog);
  const [connected, setConnected] = useState(false);
  const [menu, setMenu] = useState(false);
  const owner = profile?.name || assets[0]?.owner || 'Customer';

  useEffect(() => {
    Promise.all([get('/profile', mockProfile), get('/assets', mockAssets), get('/contacts', {contacts}), get('/status', mockStatus), get('/txlog', mockTxlog)])
      .then(([p,a,c,s,t]) => { setProfile(p?.name ? p : mockProfile); setAssets(a?.length ? a : mockAssets); setContacts(c?.contacts?.length ? c.contacts : contacts); setStatus(s); setTxlog(t); });
    fetch(`${API}/health`, {signal: AbortSignal.timeout(1800)}).then(r => setConnected(r.ok)).catch(()=>{});
  }, []);

  const content = {
    dashboard: <Dashboard owner={owner} assets={assets} status={status} go={setPage}/>,
    upload: <Upload assets={assets} setAssets={setAssets}/>,
    assets: <Assets assets={assets}/>,
    beneficiaries: <Beneficiaries assets={assets} setAssets={setAssets}/>,
    contacts: <Contacts contacts={contacts}/>,
    protection: <Protection status={status} setStatus={setStatus}/>,
    confirmation: <Confirmation owner={owner} contacts={contacts} status={status}/>,
    transactions: <Transactions txlog={txlog}/>,
    beneficiary: <BeneficiaryView assets={assets} profile={profile}/>
  }[page];

  return <div className="shell">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <button className="close-mobile" onClick={()=>setMenu(false)}><X/></button>
      <div className="brand"><div className="brandmark">अ</div><div><b>Amanat</b><span>Your legacy, protected</span></div></div>
      <nav>{nav.map(([id,label,Icon]) => <button key={id} className={page===id?'active':''} onClick={()=>{setPage(id);setMenu(false)}}><Icon size={19}/><span>{label}</span>{id==='beneficiary' && <em>Demo</em>}</button>)}</nav>
      <div className="sidebar-foot"><div className="shield-mini"><ShieldCheck/><div><b>Vault protected</b><span>AES-256 encrypted</span></div></div><div className="user"><div className="avatar">{owner.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><b>{owner}</b><span>Account owner</span></div><MoreHorizontal/></div></div>
    </aside>
    <main>
      <header><button className="menu" onClick={()=>setMenu(true)}><Menu/></button><div className="crumb">AMANAT <ChevronRight/> <b>{nav.find(n=>n[0]===page)?.[1]}</b></div><div className="header-actions"><span className={connected?'live':'demo'}><i></i>{connected?'Backend live':'Demo data'}</span><button><Search/></button><button><Bell/></button></div></header>
      <section className="page">{content}</section>
    </main>
  </div>;
}

function PageTitle({eyebrow,title,sub,action}) { return <div className="page-title"><div><span>{eyebrow}</span><h1>{title}</h1><p>{sub}</p></div>{action}</div> }
function Dashboard({owner,assets,status,go}) {
  const total=assets.reduce((s,a)=>s+(a.value||0),0), missing=assets.filter(a=>!a.nominee);
  const counts=assets.reduce((o,a)=>(o[category(a.asset_type)]=(o[category(a.asset_type)]||0)+1,o),{});
  return <>
    <PageTitle eyebrow="GOOD MORNING" title={<>Welcome back, <em>{firstName(owner)}</em></>} sub="Here's a clear view of everything you're protecting." action={<button className="primary" onClick={()=>go('upload')}><Plus/> Add document</button>}/>
    <div className="hero-card"><div><span>TOTAL LEGACY VALUE</span><h2>{money(total)}</h2><p><ShieldCheck/> Protected across {assets.length} financial assets</p></div><div className="hero-art"><Shield/><span>AMANAT VAULT</span></div></div>
    <div className="stats">{[['Bank',Landmark,'bank'],['Insurance',ShieldCheck,'insurance'],['Provident Fund',WalletCards,'pf'],['Investments',TrendingUp,'invest']].map(([label,Icon,cl])=><div className="stat" key={label}><div className={`icon ${cl}`}><Icon/></div><div><strong>{counts[label]||0}</strong><span>{label}</span></div><ChevronRight/></div>)}</div>
    {missing.length>0 && <div className="warning"><AlertTriangle/><div><b>{missing.length} asset {missing.length===1?'has':'have'} no nominee</b><span>Add a nominee to make claiming easier for your family.</span></div><button onClick={()=>go('beneficiaries')}>Review now <ChevronRight/></button></div>}
    <div className="section-head"><div><span>YOUR ASSETS</span><h3>Recently added</h3></div><button className="text-btn" onClick={()=>go('assets')}>View all assets <ArrowUpRight/></button></div>
    <AssetTable assets={assets.slice(0,4)}/>
    <div className="bottom-grid"><div className="mini-panel"><div className="panel-title"><div><ShieldCheck/><span><b>Protection is active</b><small>Last checked in today</small></span></div><span className="pill green">{status.state}</span></div><div className="progress"><i style={{width:'68%'}}></i></div><p>Next check-in due in <b>29 days</b></p></div><div className="mini-panel"><div className="panel-title"><div><UserCheck/><span><b>Trusted circle</b><small>Your verification network</small></span></div><span className="pill">2 of 3 ready</span></div><div className="face-row">{['SI','MR','AS'].map((x,i)=><i key={x} className={i<2?'ready':''}>{x}{i<2&&<Check/>}</i>)}<button onClick={()=>go('contacts')}>Manage <ChevronRight/></button></div></div></div>
  </>
}

function AssetTable({assets}) { return <div className="table-card"><div className="table-row table-head"><span>INSTITUTION</span><span>ASSET TYPE</span><span>ACCOUNT</span><span>NOMINEE</span><span>VALUE</span></div>{assets.map(a=><div className="table-row" key={a.id}><span className="institution"><i>{a.institution.slice(0,2)}</i><b>{a.institution}</b></span><span>{a.asset_type}</span><span className="mono">{a.account_number}</span><span>{a.nominee?<><CheckCircle2 className="ok"/> {a.nominee}</>:<span className="missing"><AlertTriangle/> Missing</span>}</span><strong>{money(a.value)}</strong></div>)}</div> }

function Upload({setAssets}) {
 const [files,setFiles]=useState([]),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 const analyze=async()=>{if(!files.length)return;setBusy(true);const fd=new FormData();files.forEach(f=>fd.append('files',f));try{const r=await post('/upload',fd);if(r.assets?.length)setAssets(old=>[...old,...r.assets]);}catch{}finally{setTimeout(()=>{setBusy(false);setDone(true)},700)}};
 return <><PageTitle eyebrow="DOCUMENT INTAKE" title="Let AI map your assets" sub="Upload financial documents. We extract the important details and encrypt them in your vault."/>
 <div className="upload-layout"><div className="drop-card" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setFiles([...e.dataTransfer.files]);setDone(false)}}><div className="upload-icon"><UploadCloud/></div><h2>Drop your documents here</h2><p>Bank statements, FD receipts, insurance policies or PF passbooks</p><label className="primary">Choose files<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" onChange={e=>{setFiles([...e.target.files]);setDone(false)}}/></label><small>PDF, PNG or JPG · Maximum 15 MB each</small></div><div className="privacy-card"><LockKeyhole/><div><b>Your documents stay private</b><p>Files are processed securely. Only structured asset details are saved inside your encrypted vault.</p></div></div></div>
 {files.length>0&&<div className="file-list"><div className="section-head"><div><span>READY TO ANALYZE</span><h3>{files.length} document{files.length>1?'s':''}</h3></div><button className="primary" onClick={analyze} disabled={busy}>{busy?<><Loader2 className="spin"/>Analyzing…</>:done?<><Check/>Analyzed</>:<>Analyze documents <ArrowUpRight/></>}</button></div>{files.map((f,i)=><div className="file" key={f.name}><FileText/><div><b>{f.name}</b><span>{(f.size/1024/1024).toFixed(1)} MB · Ready</span></div><button onClick={()=>setFiles(files.filter((_,j)=>j!==i))}><X/></button></div>)}</div>}
 <div className="supported"><span>SUPPORTED DOCUMENTS</span>{[['Bank statement',Landmark],['Fixed deposit',WalletCards],['LIC policy',Shield],['PF passbook',FileText]].map(([x,I])=><div><I/><b>{x}</b><small>AI auto-detects details</small></div>)}</div></>
}

function Assets({assets}) {return <><PageTitle eyebrow="YOUR FINANCIAL WORLD" title="Asset map" sub="A single, organized view of every asset discovered from your documents." action={<span className="pill green"><Check/> {assets.length} assets mapped</span>}/><div className="asset-grid">{assets.map(a=><div className={`asset-card ${!a.nominee?'flagged':''}`} key={a.id}><div className="asset-top"><div className="asset-logo">{a.institution.slice(0,2)}</div><span>{category(a.asset_type)}</span><MoreHorizontal/></div><h3>{a.asset_type}</h3><p>{a.institution} · <span className="mono">{a.account_number}</span></p><strong>{money(a.value)}</strong><div className="asset-foot">{a.nominee?<span><CheckCircle2/> Nominee: {a.nominee}</span>:<span className="missing"><AlertTriangle/> Nominee missing</span>}<ChevronRight/></div></div>)}</div></>}

function Beneficiaries({assets,setAssets}) { const update=(id,index,share)=>setAssets(assets.map(a=>a.id===id?{...a,beneficiaries:a.beneficiaries.map((b,i)=>i===index?{...b,share:Number(share)}:b)}:a)); return <><PageTitle eyebrow="DISTRIBUTION PLAN" title="Choose who receives what" sub="Set a clear percentage split for every asset. Each asset must add up to 100%."/><div className="benefit-list">{assets.map(a=>{const sum=a.beneficiaries.reduce((s,b)=>s+b.share,0);return <div className="benefit-card" key={a.id}><div className="benefit-asset"><div className="asset-logo">{a.institution.slice(0,2)}</div><div><span>{a.institution}</span><h3>{a.asset_type}</h3><p>{a.account_number} · {money(a.value)}</p></div>{!a.nominee&&<span className="missing"><AlertTriangle/> No nominee</span>}</div><div className="split"><span>BENEFICIARY SPLIT</span>{a.beneficiaries.map((b,i)=><div className="person" key={b.name}><div className="avatar soft">{b.name.split(' ').map(x=>x[0]).join('')}</div><div><b>{b.name}</b><span>{b.relation}</span></div><div className="percent"><input type="number" value={b.share} onChange={e=>update(a.id,i,e.target.value)}/><b>%</b></div></div>)}<div className={sum===100?'total valid':'total invalid'}><span>Total allocation</span><b>{sum}% {sum===100&&<Check/>}</b></div></div></div>})}</div></>}

function Contacts({contacts}) {return <><PageTitle eyebrow="YOUR VERIFICATION NETWORK" title="Trusted contacts" sub="These people verify your status together. At least 2 of 3 confirmations are required." action={<button className="primary"><Plus/> Add contact</button>}/><div className="threshold"><div><UsersRound/><span><b>2 of 3 required</b><small>No single person can unlock your vault.</small></span></div><div className="nodes"><i className="on">1</i><span></span><i className="on">2</i><span></span><i>3</i></div></div><div className="contact-grid">{contacts.map((c,i)=><div className="contact-card" key={c.id||c.name}><div className="contact-num">0{i+1}</div><div className="avatar big">{c.name.split(' ').map(x=>x[0]).join('')}</div><h3>{c.name}</h3><p>{c.relation}</p><span>{c.phone}</span><div className={`contact-status ${c.status==='accepted'?'accepted':'pending'}`}>{c.status==='accepted'?<CheckCircle2/>:<Clock3/>}{c.status==='accepted'?'Accepted & ready':'Invitation pending'}</div><button>View details <ChevronRight/></button></div>)}</div></>}

function Protection({status,setStatus}) { const [checked,setChecked]=useState(false); return <><PageTitle eyebrow="DEAD MAN'S SWITCH" title="Protection status" sub="A simple check-in keeps your vault private. If you miss it, your trusted circle is contacted."/><div className="protection-grid"><div className="status-orb"><div className="rings"><div><ShieldCheck/></div></div><span className="pill green">● {status.state}</span><h2>Your legacy is protected</h2><p>Everything is secure. Check in before the timer ends to keep your protection active.</p><button className="primary large" onClick={()=>{setChecked(true);post('/checkin').catch(()=>{})}}>{checked?<><Check/> Checked in today</>:<><RefreshCw/> I'm safe — check me in</>}</button></div><div className="countdown-card"><span>NEXT CHECK-IN</span><div className="countdown"><b>29<small>DAYS</small></b><i>:</i><b>14<small>HOURS</small></b><i>:</i><b>38<small>MIN</small></b></div><div className="timeline"><i className="done"><Check/></i><span></span><i>2</i><span></span><i>3</i></div><div className="timeline-labels"><span><b>Active</b><small>You're here</small></span><span><b>Grace period</b><small>7 days</small></span><span><b>Verification</b><small>2 of 3 contacts</small></span></div><div className="grace"><Clock3/><div><b>Grace period safety net</b><p>If you miss a check-in, you get 7 additional days and repeated reminders before anyone is contacted.</p></div></div></div></div></>}

function Confirmation({owner,contacts}) {const [confirmed,setConfirmed]=useState(false); return <><PageTitle eyebrow="MOBILE DEMO" title="Contact confirmation" sub="This is the secure screen a trusted contact sees on their phone."/><div className="phone-stage"><div className="phone"><div className="phone-top"><span>9:41</span><i></i><b>•••</b></div><div className="phone-body">{confirmed?<><div className="confirmed-icon"><Check/></div><h2>Confirmation recorded</h2><p>Thank you. One more trusted contact must independently confirm before anything is released.</p><div className="confirm-progress"><span><Check/> You confirmed</span><span>1 of 2 required</span></div></>:<><div className="phone-brand"><div className="brandmark">अ</div>Amanat</div><div className="alert-icon"><AlertTriangle/></div><span className="eyebrow">SENSITIVE CONFIRMATION</span><h2>Confirm {owner}'s passing?</h2><p>This is a serious and irreversible declaration. Please confirm only if you know this information to be true.</p><div className="identity"><div className="avatar">{owner.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><b>{owner}</b><span>Vault owner</span></div></div><button className="danger" onClick={()=>setConfirmed(true)}>Yes, I confirm</button><button className="ghost">I can't confirm this</button><small><LockKeyhole/> Your identity and timestamp will be securely recorded</small></>}</div></div><div className="phone-notes"><span>DEMO FLOW</span><h3>Built for clarity under pressure</h3><p>The contact sees the customer's actual name, understands the gravity of the action, and can never trigger release alone.</p>{contacts.slice(0,2).map((c,i)=><div><i>{i+1}</i><span><b>{c.name}</b><small>{i===0?'Confirmation requested':'Second verification required'}</small></span></div>)}</div></div></>}

function Transactions({txlog}) {return <><PageTitle eyebrow="AUDIT TRAIL" title="Transaction log" sub="Every critical action is permanently recorded for transparency and trust." action={<span className="pill green"><ShieldCheck/> Network verified</span>}/><div className="tx-summary"><div><span>VAULT HASH</span><b className="mono">0x3f1c...a9e2</b><small>Latest encrypted vault fingerprint</small></div><div><span>NETWORK</span><b>Polygon Amoy</b><small>Testnet · Block 12,482,091</small></div><div><span>EVENTS</span><b>{txlog.length}</b><small>All successfully recorded</small></div></div><div className="timeline-log">{txlog.map((t,i)=><div className="tx" key={t.tx_hash||i}><div className="tx-line"><i><Check/></i>{i<txlog.length-1&&<span/>}</div><div><span>{new Date(t.timestamp).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</span><h3>{t.event.replace(/([A-Z])/g,' $1').trim()}</h3><p>{t.details}</p><a href={t.explorer_url||'#'}>{t.tx_hash?.slice(0,18)}…{t.tx_hash?.slice(-6)} <ArrowUpRight/></a></div><span className="pill green">Confirmed</span></div>)}</div></>}

function BeneficiaryView({assets,profile}) {const person=profile.family?.[0]?.name||assets.flatMap(a=>a.beneficiaries)[0]?.name||'Beneficiary';const mine=assets.filter(a=>a.beneficiaries.some(b=>b.name===person));const total=mine.reduce((s,a)=>s+a.value*(a.beneficiaries.find(b=>b.name===person)?.share||0)/100,0);return <><div className="beneficiary-hero"><div className="beneficiary-brand"><div className="brandmark">अ</div>Amanat</div><span>LEGACY RELEASED TO YOU</span><h1>Hello, {firstName(person)}</h1><p>{profile.name}'s protected instructions are now available. We'll guide you through every step.</p><div><small>TOTAL VALUE ASSIGNED TO YOU</small><strong>{money(total)}</strong><em>Across {mine.length} assets</em></div></div><div className="released-note"><CheckCircle2/><div><b>Identity verified. Assets securely released.</b><span>Your claim information is private and visible only to you.</span></div></div><div className="section-head"><div><span>YOUR INHERITANCE</span><h3>Assets assigned to you</h3></div></div><div className="claim-grid">{mine.map((a,ix)=>{const share=a.beneficiaries.find(b=>b.name===person)?.share||0;return <div className="claim-card" key={a.id}><div className="claim-head"><div className="asset-logo">{a.institution.slice(0,2)}</div><div><span>{a.institution}</span><h3>{a.asset_type}</h3><p>{a.account_number}</p></div><span className="pill">{share}% share</span></div><div className="your-value"><span>VALUE ASSIGNED TO YOU</span><strong>{money(a.value*share/100)}</strong></div><div className="checklist"><span>CLAIM CHECKLIST</span>{(ix===0?mockClaim.steps.slice(0,4):['Get the official death certificate','Complete the institution claim form','Submit your identity and bank details','Track the claim with the institution']).map((s,i)=><label key={s}><i>{i+1}</i><span>{s}</span><Circle/></label>)}</div><button className="claim-btn">Start claim <ArrowUpRight/></button></div>})}</div></>}

createRoot(document.getElementById('root')).render(<App/>);
