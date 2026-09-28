// Ramesh's app (the vault owner). Design by Ananya; wired to the live backend.
// Deliberately has NO beneficiary view and NO contact-confirmation screen: those belong
// to other people and open from their own private links (see ContactApp / FamilyApp).
import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, UploadCloud, Map, UsersRound, ShieldCheck, ScrollText, Bell, ChevronRight,
  AlertTriangle, WalletCards, Landmark, Shield, TrendingUp, Check, Clock3, FileText, X, ArrowUpRight,
  Plus, LockKeyhole, HeartHandshake, CheckCircle2, UserCheck, RefreshCw, Menu, Loader2, IdCard,
  Siren, Send, Copy, Trash2, KeyRound, LogOut, Save, Link2,
} from 'lucide-react';
import { API, ApiError, api, getKey, setKey } from './api.js';
import {
  ActionButton, CATEGORY, Countdown, PageTitle, firstName, initials, money, usePoll, useToast, when,
} from './ui.jsx';

const NAV = [
  ['dashboard', 'Overview', LayoutDashboard], ['upload', 'Upload documents', UploadCloud],
  ['assets', 'Asset map', Map], ['beneficiaries', 'Beneficiaries', UsersRound],
  ['contacts', 'Trusted contacts', HeartHandshake], ['protection', 'Protection status', ShieldCheck],
  ['transactions', 'Transaction log', ScrollText], ['card', 'Emergency card', IdCard],
];

export default function OwnerApp() {
  const [locked, setLocked] = useState(!getKey());
  if (locked) return <Unlock onDone={() => setLocked(false)} />;
  return <Shell onLock={() => { setKey(''); setLocked(true); }} />;
}

// ---------------------------------------------------------------- unlock
function Unlock({ onDone }) {
  const [key, setK] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError(''); setKey(key.trim());
    try { await api('/summary'); onDone(); }
    catch (err) { setKey(''); setError(err.status === 401 ? 'That key is not right. Check the "Owner key" line printed by run_lan.ps1.' : err.message); }
    finally { setBusy(false); }
  };
  return <div className="unlock"><form onSubmit={submit} className="unlock-card">
    <div className="brand dark"><div className="brandmark">अ</div><div><b>Amanat</b><span>Your family's inheritance, held in trust.</span></div></div>
    <KeyRound className="unlock-icon" />
    <h1>Unlock your vault</h1>
    <p>Enter your owner key. It stays on this device only.</p>
    <input className="field" type="password" autoFocus value={key} onChange={e => setK(e.target.value)} placeholder="Owner key" />
    {error && <div className="form-error"><AlertTriangle />{error}</div>}
    <button className="primary large" disabled={!key.trim() || busy}>{busy ? <><Loader2 className="spin" />Checking…</> : <>Unlock <ArrowUpRight /></>}</button>
    <small>Backend: {API}</small>
  </form></div>;
}

// ---------------------------------------------------------------- shell + data
async function loadAll() {
  const [summary, assets, contacts, status, profile, health] = await Promise.all([
    api('/summary'), api('/assets'), api('/contacts'), api('/status'), api('/profile'), api('/health', { owner: false }),
  ]);
  return { summary, assets, contacts, status, profile, health };
}

function Shell({ onLock }) {
  const [page, setPage] = useState(() => location.hash.slice(1) || 'dashboard');
  const [menu, setMenu] = useState(false);
  const [data, error, refresh] = usePoll(loadAll, 4000);
  useEffect(() => { if (location.hash.slice(1) !== page) location.hash = page; }, [page]);
  // Follow the URL too: browser Back/Forward and typed #links switch pages.
  useEffect(() => {
    const onHash = () => setPage(location.hash.slice(1) || 'dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { if (error?.status === 401) onLock(); }, [error]);

  if (!data) {
    return <div className="unlock"><div className="unlock-card">
      {error ? <><AlertTriangle className="unlock-icon warn" /><h1>Can't reach the backend</h1><p>{error.message}</p>
        <button className="primary" onClick={refresh}><RefreshCw /> Try again</button></>
        : <><Loader2 className="spin unlock-icon" /><h1>Opening your vault…</h1></>}
    </div></div>;
  }

  const owner = data.profile?.name || data.summary.owner || 'Account owner';
  const go = p => { setPage(p); setMenu(false); };
  const props = { data, refresh, go, owner };
  const content = {
    dashboard: <Dashboard {...props} />, upload: <Upload {...props} />, assets: <Assets {...props} />,
    beneficiaries: <Beneficiaries {...props} />, contacts: <Contacts {...props} />,
    protection: <Protection {...props} />, transactions: <Transactions {...props} />, card: <EmergencyCard {...props} />,
  }[page] || <Dashboard {...props} />;
  const alerts = data.summary.warnings.filter(w => w.type.startsWith('emergency_')).length;

  return <div className="shell">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <button className="close-mobile" onClick={() => setMenu(false)}><X /></button>
      <div className="brand"><div className="brandmark">अ</div><div><b>Amanat</b><span>Your legacy, protected</span></div></div>
      <nav>{NAV.map(([id, label, Icon]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-foot">
        <div className="shield-mini"><ShieldCheck /><div><b>Vault encrypted</b><span className="mono-light">{data.summary.vault_hash ? `${data.summary.vault_hash.slice(0, 10)}…` : 'AES-256-GCM'}</span></div></div>
        <div className="user"><div className="avatar">{initials(owner)}</div><div><b>{owner}</b><span>Account owner</span></div>
          <button className="icon-btn" title="Lock (forget key on this device)" onClick={onLock}><LogOut /></button></div>
      </div>
    </aside>
    <main>
      <header><button className="menu" onClick={() => setMenu(true)}><Menu /></button>
        <div className="crumb">AMANAT <ChevronRight /> <b>{NAV.find(n => n[0] === page)?.[1] || 'Overview'}</b></div>
        <div className="header-actions">
          <span className={error ? 'demo' : 'live'}><i></i>{error ? 'Reconnecting…' : 'Backend live'}</span>
          <button title="Alerts" className={alerts ? 'bell-alert' : ''} onClick={() => go('dashboard')}><Bell /></button>
        </div>
      </header>
      <section className="page">{content}</section>
    </main>
  </div>;
}

// ---------------------------------------------------------------- dashboard
function greeting() { const h = new Date().getHours(); return h < 12 ? 'GOOD MORNING' : h < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING'; }

function Dashboard({ data, refresh, go, owner }) {
  const { summary, assets, contacts, status } = data;
  const toast = useToast();
  const emergency = summary.warnings.filter(w => w.type.startsWith('emergency_'));
  const others = summary.warnings.filter(w => !w.type.startsWith('emergency_'));
  const circle = summary.circle;
  const [showAll, setShowAll] = useState(false);
  return <>
    <PageTitle eyebrow={greeting()} title={<>Welcome back, <em>{firstName(owner)}</em></>} sub="Here's a clear view of everything you're protecting."
      action={<button className="primary" onClick={() => go('upload')}><Plus /> Add document</button>} />

    {emergency.map(w => <div className="emergency-banner" key={w.type}><Siren /><div><b>{w.type === 'emergency_active' ? 'Emergency access is open' : 'Are you OK?'}</b><span>{w.message}</span></div>
      <ActionButton className="primary light" onClick={async () => { await api('/emergency/cancel', { method: 'POST' }); toast.ok('Thanks. Your circle has been told you are OK.'); refresh(); }}>
        <Check /> I'm OK</ActionButton></div>)}

    <div className="hero-card"><div><span>TOTAL LEGACY VALUE</span><h2>{money(summary.total_value)}</h2><p><ShieldCheck /> Protected across {summary.asset_count} financial asset{summary.asset_count === 1 ? '' : 's'}</p></div><div className="hero-art"><Shield /><span>AMANAT VAULT</span></div></div>
    <div className="stats">{[['Bank', Landmark, 'bank'], ['Insurance', ShieldCheck, 'insurance'], ['PF', WalletCards, 'pf'], ['Investments', TrendingUp, 'invest']].map(([label, Icon, cl]) =>
      <div className="stat" key={label} onClick={() => go('assets')}><div className={`icon ${cl}`}><Icon /></div><div><strong>{summary.counts[label] || 0}</strong><span>{label === 'PF' ? 'Provident Fund' : label}</span></div><ChevronRight /></div>)}</div>

    {others.length > 0 && <div className="alert-list">{(showAll ? others : others.slice(0, 3)).map((w, i) =>
      <div className="warning" key={i}><AlertTriangle /><div><b>{w.message}</b><span>{hintFor(w.type)}</span></div>
        <button onClick={() => go(w.type.startsWith('contact') || w.type === 'circle_incomplete' ? 'contacts' : w.type === 'no_beneficiary' ? 'beneficiaries' : 'assets')}>Review <ChevronRight /></button></div>)}
      {others.length > 3 && <button className="text-btn more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show ${others.length - 3} more`}</button>}</div>}

    <div className="section-head"><div><span>YOUR ASSETS</span><h3>Recently added</h3></div>{assets.length > 0 && <button className="text-btn" onClick={() => go('assets')}>View all assets <ArrowUpRight /></button>}</div>
    {assets.length ? <AssetTable assets={assets.slice(-4).reverse()} /> : <Empty icon={UploadCloud} title="No assets yet" text="Upload a bank statement, FD receipt, insurance policy or PF passbook. Amanat's AI will find the assets in it." action={<button className="primary" onClick={() => go('upload')}><UploadCloud /> Upload documents</button>} />}

    <div className="bottom-grid">
      <div className="mini-panel"><div className="panel-title"><div><ShieldCheck /><span><b>Protection: {status.state?.toLowerCase()}</b><small>{data.health.keeper_connected && status.last_check_in ? `Last check-in ${when(status.last_check_in)}` : 'Waiting for the blockchain keeper'}</small></span></div><span className={`pill ${status.state === 'ACTIVE' ? 'green' : ''}`}>{status.state}</span></div>
        <p style={{ marginTop: 14 }}>{!data.health.keeper_connected ? 'Blockchain keeper not connected yet: sample status.'
          : status.next_deadline ? <>Next check-in due <b>{when(status.next_deadline)}</b></> : 'Check-in schedule not set'}</p>
        <button className="text-btn" onClick={() => go('protection')}>Open protection <ChevronRight /></button></div>
      <div className="mini-panel"><div className="panel-title"><div><UserCheck /><span><b>Trusted circle</b><small>Your verification network</small></span></div><span className={`pill ${circle.accepted >= circle.required ? 'green' : ''}`}>{circle.accepted} of {circle.total || 3} accepted</span></div>
        <div className="face-row">{contacts.contacts.map(c => <i key={c.id} className={c.status === 'accepted' ? 'ready' : ''} title={`${c.name}: ${c.status}`}>{initials(c.name)}{c.status === 'accepted' && <Check />}</i>)}
          {contacts.contacts.length === 0 && <small className="muted">No trusted contacts yet</small>}
          <button onClick={() => go('contacts')}>Manage <ChevronRight /></button></div></div>
    </div>
  </>;
}

function hintFor(type) {
  return {
    missing_nominee: 'Register a nominee with the institution so your family can claim faster.',
    no_beneficiary: 'Choose who should receive this asset.',
    contact_not_accepted: 'They were sent an invite link. You can resend it.',
    contact_declined: 'Pick someone else you trust.',
    contact_awaiting_response: 'They have not answered the latest "still reachable?" check.',
    contact_stale: 'Check their number is still right.',
    circle_incomplete: 'At least 2 trusted contacts must accept before a release can ever be confirmed.',
  }[type] || '';
}

function Empty({ icon: Icon, title, text, action }) {
  return <div className="empty"><div className="upload-icon"><Icon /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function AssetTable({ assets }) {
  return <div className="table-card"><div className="table-row table-head"><span>INSTITUTION</span><span>ASSET TYPE</span><span>ACCOUNT</span><span>NOMINEE</span><span>VALUE</span></div>
    {assets.map(a => <div className="table-row" key={a.id}><span className="institution"><i>{a.institution.slice(0, 2)}</i><b>{a.institution}</b></span><span>{a.asset_type}</span><span className="mono">{a.account_number || '-'}</span>
      <span>{a.nominee ? <><CheckCircle2 className="ok" /> {a.nominee}</> : <span className="missing"><AlertTriangle /> Missing</span>}</span><strong>{a.value != null ? money(a.value) : '-'}</strong></div>)}</div>;
}

// ---------------------------------------------------------------- upload
function Upload({ refresh, go }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const toast = useToast();
  const pick = list => { setFiles([...list]); setResult(null); };
  const analyze = async () => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    setBusy(true);
    try {
      // The AI may take up to ~45 s per document when busy; files run in parallel.
      const r = await api('/upload', { method: 'POST', body: fd, timeout: 120000 });
      setResult(r); setFiles([]); refresh();
      toast.ok(r.assets.length ? `Found ${r.assets.length} asset${r.assets.length > 1 ? 's' : ''}` : 'No new assets found');
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  };
  return <><PageTitle eyebrow="DOCUMENT INTAKE" title="Let AI map your assets" sub="Upload financial documents. We extract the important details and encrypt them in your vault." />
    <div className="upload-layout"><div className="drop-card" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files); }}>
      <div className="upload-icon"><UploadCloud /></div><h2>Drop your documents here</h2><p>Bank statements, FD receipts, insurance policies or PF passbooks</p>
      <label className="primary">Choose files<input type="file" multiple accept=".pdf,.txt" onChange={e => pick(e.target.files)} /></label><small>PDF (text or scanned) · Maximum 15 MB each</small></div>
      <div className="privacy-card"><LockKeyhole /><div><b>Your documents stay private</b><p>Only structured asset details are kept, inside a vault encrypted with AES-256. Account numbers are masked on screen.</p></div></div></div>

    {files.length > 0 && <div className="file-list"><div className="section-head"><div><span>READY TO ANALYZE</span><h3>{files.length} document{files.length > 1 ? 's' : ''}</h3></div>
      <button className="primary" onClick={analyze} disabled={busy}>{busy ? <><Loader2 className="spin" />Reading with AI…</> : <>Analyze documents <ArrowUpRight /></>}</button></div>
      {files.map((f, i) => <div className="file" key={f.name + i}><FileText /><div><b>{f.name}</b><span>{(f.size / 1024).toFixed(0)} KB · Ready</span></div><button disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X /></button></div>)}</div>}

    {result && <div className="file-list"><div className="section-head"><div><span>RESULT</span><h3>{result.assets.length} new asset{result.assets.length === 1 ? '' : 's'} found</h3></div>
      {result.assets.length > 0 && <button className="primary" onClick={() => go('assets')}>View asset map <ArrowUpRight /></button>}</div>
      {result.files.map((f, i) => <div className="file" key={i}>{f.error ? <AlertTriangle className="bad" /> : <CheckCircle2 className="ok" />}<div>
        <b>{f.file}</b>
        <span>{f.error ? f.error : `${f.assets.length} asset${f.assets.length === 1 ? '' : 's'} · read by ${readBy(f.extracted_by)}${f.duplicates_skipped ? ` · ${f.duplicates_skipped} already in vault` : ''}`}</span>
        {f.note && <span className="note">{f.note}</span>}</div></div>)}
      {result.warnings.map((w, i) => <div className="warning slim" key={i}><AlertTriangle /><div><b>{w.message}</b><span>{hintFor(w.type)}</span></div></div>)}</div>}

    <div className="supported"><span>SUPPORTED DOCUMENTS</span>{[['Bank statement', Landmark], ['Fixed deposit', WalletCards], ['LIC policy', Shield], ['PF passbook', FileText]].map(([x, I]) =>
      <div key={x}><I /><b>{x}</b><small>AI auto-detects details</small></div>)}</div></>;
}
const readBy = by => by?.startsWith('cache:') ? `AI (${by.slice(6)}, saved result)` : by === 'rules' ? 'offline reader' : `AI (${by})`;

// ---------------------------------------------------------------- assets
function Assets({ data, go }) {
  const { assets } = data;
  return <><PageTitle eyebrow="YOUR FINANCIAL WORLD" title="Asset map" sub="A single, organized view of every asset discovered from your documents." action={<span className="pill green"><Check /> {assets.length} assets mapped</span>} />
    {assets.length === 0 ? <Empty icon={Map} title="Nothing mapped yet" text="Upload documents and the assets will appear here." action={<button className="primary" onClick={() => go('upload')}><UploadCloud /> Upload documents</button>} />
      : <div className="asset-grid">{assets.map(a => <div className={`asset-card ${!a.nominee ? 'flagged' : ''}`} key={a.id}>
        <div className="asset-top"><div className="asset-logo">{a.institution.slice(0, 2)}</div><span>{CATEGORY[a.asset_type] || 'Other'}</span></div>
        <h3>{a.asset_type}</h3><p>{a.institution} · <span className="mono">{a.account_number || '-'}</span></p><strong>{a.value != null ? money(a.value) : 'Value not shown'}</strong>
        <div className="asset-foot">{a.nominee ? <span><CheckCircle2 /> Nominee: {a.nominee}</span> : <span className="missing"><AlertTriangle /> Nominee missing</span>}
          <span className="muted">{a.beneficiaries.length ? `${a.beneficiaries.length} beneficiar${a.beneficiaries.length > 1 ? 'ies' : 'y'}` : 'No beneficiary'}</span></div></div>)}</div>}</>;
}

// ---------------------------------------------------------------- beneficiaries
function Beneficiaries({ data, refresh, go }) {
  const { assets, profile } = data;
  const people = useMemo(() => {
    const m = new globalThis.Map();
    (profile.family || []).forEach(p => p.name && m.set(p.name, p.relation || ''));
    assets.forEach(a => a.beneficiaries.forEach(b => m.set(b.name, b.relation)));
    return [...m.entries()].map(([name, relation]) => ({ name, relation }));
  }, [assets, profile]);
  if (!assets.length) return <><PageTitle eyebrow="DISTRIBUTION PLAN" title="Choose who receives what" sub="Set a clear percentage split for every asset." />
    <Empty icon={UsersRound} title="No assets yet" text="Upload documents first, then decide who receives each asset." action={<button className="primary" onClick={() => go('upload')}><UploadCloud /> Upload documents</button>} /></>;
  return <><PageTitle eyebrow="DISTRIBUTION PLAN" title="Choose who receives what" sub="Set a clear percentage split for every asset. Each asset must add up to 100%. Beneficiaries are told nothing until release." />
    <div className="benefit-list">{assets.map(a => <SplitEditor key={a.id} asset={a} people={people} refresh={refresh} />)}</div></>;
}

function SplitEditor({ asset, people, refresh }) {
  const [rows, setRows] = useState(asset.beneficiaries);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRel, setNewRel] = useState('');
  const toast = useToast();
  const saved = JSON.stringify(asset.beneficiaries);
  useEffect(() => setRows(asset.beneficiaries), [saved]);
  const dirty = JSON.stringify(rows) !== saved;
  const sum = rows.reduce((s, b) => s + (Number(b.share) || 0), 0);
  const add = (name, relation) => {
    if (!name.trim() || rows.some(r => r.name.toLowerCase() === name.trim().toLowerCase())) return;
    setRows([...rows, { name: name.trim(), relation: relation.trim() || 'Family', share: rows.length ? 0 : 100 }]);
    setAdding(false); setNewName(''); setNewRel('');
  };
  const save = async () => {
    await api('/beneficiaries', { method: 'POST', body: { asset_id: asset.id, beneficiaries: rows.map(r => ({ ...r, share: Number(r.share) })) } });
    toast.ok(`Saved split for ${asset.institution} ${asset.asset_type}`); refresh();
  };
  const suggestions = people.filter(p => !rows.some(r => r.name === p.name));
  return <div className="benefit-card"><div className="benefit-asset"><div className="asset-logo">{asset.institution.slice(0, 2)}</div>
    <div><span>{asset.institution}</span><h3>{asset.asset_type}</h3><p>{asset.account_number} · {asset.value != null ? money(asset.value) : '-'}</p></div>
    {!asset.nominee && <span className="missing"><AlertTriangle /> No nominee</span>}</div>
    <div className="split"><span>BENEFICIARY SPLIT</span>
      {rows.length === 0 && <p className="muted small">Nobody assigned yet.</p>}
      {rows.map((b, i) => <div className="person" key={b.name}><div className="avatar soft">{initials(b.name)}</div><div><b>{b.name}</b><span>{b.relation}</span></div>
        <div className="percent"><input type="number" min="0" max="100" value={b.share} onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, share: e.target.value } : r))} /><b>%</b></div>
        <button className="icon-btn" title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></button></div>)}
      {adding ? <div className="add-person"><input className="field" placeholder="Full name" value={newName} onChange={e => setNewName(e.target.value)} />
        <input className="field" placeholder="Relation" value={newRel} onChange={e => setNewRel(e.target.value)} />
        <button className="primary" onClick={() => add(newName, newRel)}>Add</button><button className="ghost-sm" onClick={() => setAdding(false)}>Cancel</button></div>
        : <div className="chips">{suggestions.map(p => <button key={p.name} className="chip" onClick={() => add(p.name, p.relation)}><Plus /> {p.name}</button>)}
          <button className="chip" onClick={() => setAdding(true)}><Plus /> Someone else</button></div>}
      <div className={sum === 100 ? 'total valid' : 'total invalid'}><span>Total allocation</span><b>{sum}% {sum === 100 && <Check />}</b></div>
      {dirty && <div className="save-row"><button className="ghost-sm" onClick={() => setRows(asset.beneficiaries)}>Undo</button>
        <ActionButton disabled={rows.length > 0 && sum !== 100} onClick={save}><Save /> Save split</ActionButton></div>}
    </div></div>;
}

// ---------------------------------------------------------------- trusted contacts
const REACH = {
  ok: ['accepted', 'Accepted & reachable'], not_accepted: ['pending', 'Invitation pending'], declined: ['declined', 'Declined'],
  awaiting_response: ['pending', 'Reachability check sent'], stale: ['pending', 'Not heard from recently'],
};

function Contacts({ data, refresh }) {
  const { contacts: { contacts, accepted, required } } = data;
  const [editing, setEditing] = useState(contacts.length === 0);
  const toast = useToast();
  return <><PageTitle eyebrow="YOUR VERIFICATION NETWORK" title="Trusted contacts" sub="Each person is invited now and must accept, so they know their role before anything happens. 2 of 3 must agree before any release."
    action={!editing && <div className="btn-row"><ActionButton className="ghost-sm" disabled={!accepted} onClick={async () => { const r = await api('/circle/ping-all', { method: 'POST' }); toast.ok(`Reachability check sent to ${r.sent.length} contact${r.sent.length === 1 ? '' : 's'}`); refresh(); }}><Send /> Check they're reachable</ActionButton>
      <button className="primary" onClick={() => setEditing(true)}><Plus /> Edit contacts</button></div>} />
    <div className="threshold"><div><UsersRound /><span><b>{accepted} of {contacts.length || 3} accepted · {required} needed</b><small>No single person can unlock your vault.</small></span></div>
      <div className="nodes">{[0, 1, 2].map(i => <React.Fragment key={i}>{i > 0 && <span></span>}<i className={contacts[i]?.status === 'accepted' ? 'on' : ''}>{i + 1}</i></React.Fragment>)}</div></div>
    {editing ? <ContactForm contacts={contacts} done={() => { setEditing(false); refresh(); }} cancel={contacts.length ? () => setEditing(false) : null} />
      : <div className="contact-grid">{contacts.map((c, i) => {
        const [cls, label] = REACH[c.reachability] || REACH.not_accepted;
        return <div className="contact-card" key={c.id}><div className="contact-num">0{i + 1}</div><div className="avatar big">{initials(c.name)}</div><h3>{c.name}</h3><p>{c.relation}</p><span>{c.phone}</span>
          <div className={`contact-status ${cls}`}>{cls === 'accepted' ? <CheckCircle2 /> : <Clock3 />}{label}</div>
          <div className="btn-row center">
            {c.status !== 'accepted' && <ActionButton className="ghost-sm" onClick={async () => { await api(`/contacts/${c.id}/resend`, { method: 'POST' }); toast.ok(`Invite re-sent to ${c.name}`); refresh(); }}><Send /> Resend</ActionButton>}
            <button className="ghost-sm" onClick={() => { navigator.clipboard?.writeText(c.invite_url); toast.ok('Invite link copied'); }}><Copy /> Copy link</button></div></div>;
      })}</div>}</>;
}

function ContactForm({ contacts, done, cancel }) {
  const blank = { name: '', relation: '', phone: '' };
  const [rows, setRows] = useState([0, 1, 2].map(i => contacts[i] ? { name: contacts[i].name, relation: contacts[i].relation, phone: contacts[i].phone || '' } : { ...blank }));
  const toast = useToast();
  const valid = rows.every(r => r.name.trim() && r.relation.trim() && r.phone.replace(/\D/g, '').length >= 6);
  const set = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  return <div className="form-card"><p className="muted">Anyone new is sent an invite immediately. People already in your circle keep their acceptance.</p>
    <div className="contact-form">{rows.map((r, i) => <div key={i} className="contact-form-row"><span className="contact-num">0{i + 1}</span>
      <input className="field" placeholder="Full name" value={r.name} onChange={e => set(i, 'name', e.target.value)} />
      <input className="field" placeholder="Relation (e.g. Brother-in-law)" value={r.relation} onChange={e => set(i, 'relation', e.target.value)} />
      <input className="field" placeholder="Phone (+91 …)" value={r.phone} onChange={e => set(i, 'phone', e.target.value)} /></div>)}</div>
    <div className="save-row">{cancel && <button className="ghost-sm" onClick={cancel}>Cancel</button>}
      <ActionButton disabled={!valid} onClick={async () => { const r = await api('/contacts', { method: 'POST', body: { contacts: rows } }); toast.ok(r.invites_sent.length ? `Invites sent to ${r.invites_sent.map(n => n.to).join(', ')}` : 'Circle saved'); done(); }}>
        <Send /> Save & send invites</ActionButton></div></div>;
}

// ---------------------------------------------------------------- protection
const STEPS = { ACTIVE: 0, GRACE: 1, CONFIRMED: 2, RELEASED: 2, CANCELLED: 0 };

function Protection({ data, refresh }) {
  const { status, health } = data;
  const toast = useToast();
  const step = STEPS[status.state] ?? 0;
  const keeper = health.keeper_connected;
  const run = async (path, ok) => {
    const r = await api(path, { method: 'POST' });
    if (r.ok === false) throw new ApiError(0, keeper ? r.error : 'Blockchain keeper not connected yet (Pratham). This button will work once it is.');
    toast.ok(ok); refresh();
  };
  return <><PageTitle eyebrow="DEAD MAN'S SWITCH" title="Protection status" sub="A simple check-in keeps your vault private. If you miss it, your trusted circle is contacted." />
    {!keeper && <div className="info-banner"><Link2 /><span><b>Blockchain keeper not connected yet.</b> The status below is sample data until Pratham's keeper is running.</span></div>}
    <div className="protection-grid"><div className="status-orb"><div className="rings"><div><ShieldCheck /></div></div><span className="pill green">● {status.state}</span>
      <h2>{status.state === 'ACTIVE' ? 'Your legacy is protected' : status.state === 'GRACE' ? 'Check-in missed: grace period' : status.state === 'RELEASED' ? 'Vault released to your family' : `Status: ${status.state}`}</h2>
      <p>{status.state === 'GRACE' ? 'Check in now to cancel. If you do not, your trusted circle will be asked to confirm.' : 'Check in before the timer ends to keep your protection active.'}</p>
      <ActionButton className="primary large light" busyText={<><Loader2 className="spin" /> Checking in…</>} onClick={async () => {
        // Check-in always counts locally as "I'm OK" (closes any emergency), even if the
        // keeper is offline; the on-chain part is reported separately.
        const r = await api('/checkin', { method: 'POST' });
        toast.ok(r.ok ? 'Checked in on-chain. Your circle knows you are OK.' : 'Checked in. (Blockchain keeper not connected, so not on-chain yet.)');
        refresh();
      }}><RefreshCw /> I'm safe — check me in</ActionButton>
      <div className="btn-row center" style={{ marginTop: 12 }}>
        <ActionButton className="ghost-dark" onClick={() => run('/activate', 'Protection activated on-chain')}><ShieldCheck /> Activate protection</ActionButton></div></div>
      <div className="countdown-card"><span>{status.state === 'GRACE' ? 'GRACE PERIOD ENDS IN' : 'NEXT CHECK-IN DUE IN'}</span>
        {/* Sample status (keeper offline) has fixed past dates: show dashes, not 00:00 "overdue". */}
        <Countdown to={!keeper ? null : status.state === 'GRACE' ? status.grace_ends : status.next_deadline} />
        <div className="timeline">{[0, 1, 2].map(i => <React.Fragment key={i}>{i > 0 && <span className={i <= step ? 'done' : ''}></span>}<i className={i <= step ? 'done' : ''}>{i < step ? <Check /> : i + 1}</i></React.Fragment>)}</div>
        <div className="timeline-labels"><span><b>Active</b><small>{step === 0 ? "You're here" : ''}</small></span><span><b>Grace period</b><small>Reminders sent</small></span><span><b>Verification</b><small>{status.confirmations ?? 0} of {status.confirmations_required ?? 2} contacts</small></span></div>
        <div className="grace"><Clock3 /><div><b>Grace period safety net</b><p>If you miss a check-in you get a grace period and reminders before anyone is contacted. Only contacts who accepted can confirm.</p></div></div>
        <div className="demo-tools"><span>DEMO CONTROL</span><ActionButton className="ghost-sm" onClick={() => run('/demo/miss-deadline', 'Deadline skipped: grace period started')}><Clock3 /> Skip to missed check-in</ActionButton></div>
      </div></div></>;
}

// ---------------------------------------------------------------- transaction log
function Transactions({ data }) {
  const [log, error] = usePoll(() => api('/txlog'), 5000);
  const onChain = (log || []).filter(t => t.tx_hash).length;
  return <><PageTitle eyebrow="AUDIT TRAIL" title="Transaction log" sub="Every critical action, recorded for transparency and trust." action={<span className={`pill ${data.health.keeper_connected ? 'green' : ''}`}><ShieldCheck /> {data.health.keeper_connected ? 'Keeper connected' : 'Keeper not connected'}</span>} />
    <div className="tx-summary"><div><span>VAULT HASH</span><b className="mono">{data.summary.vault_hash ? `${data.summary.vault_hash.slice(0, 18)}…${data.summary.vault_hash.slice(-6)}` : 'No vault yet'}</b><small>SHA-256 fingerprint of the encrypted vault, committed on-chain</small></div>
      <div><span>ON-CHAIN</span><b>{onChain} of {(log || []).length}</b><small>{onChain < (log || []).length ? 'Others wait for the keeper' : 'All recorded'}</small></div>
      <div><span>EVENTS</span><b>{(log || []).length}</b><small>This session</small></div></div>
    {error && <div className="form-error"><AlertTriangle />{error.message}</div>}
    <div className="timeline-log">{(log || []).length === 0 && <p className="muted">No events yet.</p>}
      {[...(log || [])].reverse().map((t, i, arr) => <div className="tx" key={(t.tx_hash || '') + i}><div className="tx-line"><i className={t.tx_hash ? '' : 'pending'}>{t.tx_hash ? <Check /> : <Clock3 />}</i>{i < arr.length - 1 && <span />}</div>
        <div><span>{when(t.timestamp)}</span><h3>{t.event.replace(/([A-Z])/g, ' $1').trim()}</h3><p>{t.details}</p>
          {t.tx_hash ? (t.explorer_url ? <a href={t.explorer_url} target="_blank" rel="noreferrer">{t.tx_hash.slice(0, 18)}…{t.tx_hash.slice(-6)} <ArrowUpRight /></a> : <span className="mono small">{t.tx_hash.slice(0, 18)}…{t.tx_hash.slice(-6)}</span>)
            : <span className="muted small">Not on-chain yet</span>}</div>
        <span className={`pill ${t.tx_hash ? 'green' : ''}`}>{t.tx_hash ? 'On-chain' : 'Pending'}</span></div>)}</div></>;
}

// ---------------------------------------------------------------- emergency card settings
function EmergencyCard({ data, refresh }) {
  const toast = useToast();
  const [p, setP] = useState(data.profile);
  const saved = JSON.stringify(data.profile);
  useEffect(() => setP(data.profile), [saved]);
  const set = (k, v) => setP({ ...p, [k]: v });
  const sub = (k, f, v) => setP({ ...p, [k]: { ...(p[k] || {}), [f]: v } });
  const fam = p.family || [];
  const SHARE = [['address', 'Home address'], ['family', 'Family members'], ['doctor', 'Family doctor'], ['institutions', 'Where assets are held'], ['asset_types', 'Type of each asset']];
  const save = async () => {
    const clean = { ...p, family: fam.filter(x => x.name?.trim()), doctor: p.doctor?.name?.trim() ? p.doctor : null,
      health_cover: p.health_cover?.insurer?.trim() ? { ...p.health_cover, sum_insured: p.health_cover.sum_insured ? Number(p.health_cover.sum_insured) : null } : null };
    await api('/profile', { method: 'PUT', body: clean }); toast.ok('Emergency card saved'); refresh();
  };
  return <><PageTitle eyebrow="WHAT YOUR CIRCLE SEES" title="Emergency card" sub="Your trusted contacts can always see this card. They never see amounts or account numbers."
    action={<ActionButton disabled={JSON.stringify(p) === saved} onClick={save}><Save /> Save card</ActionButton>} />
    <div className="settings-grid">
      <div className="form-card"><h3>About you</h3>
        <label>Full name<input className="field" value={p.name || ''} onChange={e => set('name', e.target.value)} /></label>
        <label>Phone<input className="field" value={p.phone || ''} onChange={e => set('phone', e.target.value)} /></label>
        <label>Address<input className="field" value={p.address || ''} onChange={e => set('address', e.target.value)} /></label>
        <label>Blood group<input className="field" value={p.blood_group || ''} onChange={e => set('blood_group', e.target.value)} /></label>
        <label>Note for your circle<textarea className="field" rows="2" value={p.note || ''} onChange={e => set('note', e.target.value)} placeholder="e.g. where important papers are kept" /></label>
        <h3>Family doctor</h3>
        <div className="two"><input className="field" placeholder="Name" value={p.doctor?.name || ''} onChange={e => sub('doctor', 'name', e.target.value)} /><input className="field" placeholder="Phone" value={p.doctor?.phone || ''} onChange={e => sub('doctor', 'phone', e.target.value)} /></div>
        <h3>Family</h3>
        {fam.map((f, i) => <div className="three" key={i}>{['name', 'relation', 'phone'].map(k => <input key={k} className="field" placeholder={k[0].toUpperCase() + k.slice(1)} value={f[k] || ''} onChange={e => set('family', fam.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} />)}
          <button className="icon-btn" onClick={() => set('family', fam.filter((_, j) => j !== i))}><Trash2 /></button></div>)}
        <button className="chip" onClick={() => set('family', [...fam, { name: '', relation: '', phone: '' }])}><Plus /> Add family member</button>
      </div>
      <div>
        <div className="form-card"><h3>Your circle can see</h3>
          {SHARE.map(([k, label]) => <label className="toggle" key={k}><input type="checkbox" checked={p.share?.[k] ?? true} onChange={e => sub('share', k, e.target.checked)} /><span>{label}</span></label>)}
          <p className="muted small">Never shown before release: amounts, account numbers, beneficiaries.</p></div>
        <div className="form-card emergency-only"><h3><Siren /> Only in an emergency</h3><p className="muted small">Shown to your circle only if 2 of 3 contacts confirm that something has happened to you (e.g. hospital). Closed as soon as you check in.</p>
          <label>Health insurer<input className="field" value={p.health_cover?.insurer || ''} onChange={e => sub('health_cover', 'insurer', e.target.value)} /></label>
          <div className="two"><label>Policy number<input className="field" value={p.health_cover?.policy_number || ''} onChange={e => sub('health_cover', 'policy_number', e.target.value)} /></label>
            <label>Helpline<input className="field" value={p.health_cover?.helpline || ''} onChange={e => sub('health_cover', 'helpline', e.target.value)} /></label></div>
          <label>Allergies<input className="field" value={p.medical?.allergies || ''} onChange={e => sub('medical', 'allergies', e.target.value)} /></label>
          <label>Conditions<input className="field" value={p.medical?.conditions || ''} onChange={e => sub('medical', 'conditions', e.target.value)} /></label>
          <label>Medications<input className="field" value={p.medical?.medications || ''} onChange={e => sub('medical', 'medications', e.target.value)} /></label></div>
      </div></div></>;
}
