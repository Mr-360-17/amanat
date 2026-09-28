// Presenter page, /demo. NOT part of Ramesh's app: it's for running the live demo.
// Shows the three people and their links, the simulated SMS feed, and demo controls.
// Needs the owner key (same unlock as Ramesh's app).
import React, { useState } from 'react';
import { ArrowUpRight, Gift, HeartHandshake, KeyRound, MessageSquare, RotateCcw, Siren, User, UploadCloud } from 'lucide-react';
import { api, getKey, localLink, setKey } from './api.js';
import { ActionButton, Brand, usePoll, useToast, when } from './ui.jsx';

async function loadDemo() {
  const [contacts, family, notes, status, health] = await Promise.all([
    api('/contacts'), api('/family'), api('/notifications'), api('/status'), api('/health', { owner: false })]);
  return { contacts: contacts.contacts, family, notes, status, health };
}

export default function DemoApp() {
  const [unlocked, setUnlocked] = useState(!!getKey());
  if (!unlocked) return <KeyGate done={() => setUnlocked(true)} />;
  return <Presenter />;
}

function KeyGate({ done }) {
  const [k, setK] = useState('');
  const [err, setErr] = useState('');
  return <div className="unlock"><form className="unlock-card" onSubmit={async e => {
    e.preventDefault(); setKey(k.trim());
    try { await api('/contacts'); done(); } catch (x) { setKey(''); setErr(x.message); }
  }}><KeyRound className="unlock-icon" /><h1>Presenter</h1><p>Enter the owner key to run the demo.</p>
    <input className="field" type="password" value={k} onChange={e => setK(e.target.value)} placeholder="Owner key" />
    {err && <div className="form-error">{err}</div>}<button className="primary">Continue</button></form></div>;
}

function Presenter() {
  const [d, error, refresh] = usePoll(loadDemo, 2500);
  const toast = useToast();
  const act = async (path, ok) => { await api(path, { method: 'POST' }); toast.ok(ok); refresh(); };
  if (!d) return <div className="unlock"><div className="unlock-card"><p>{error ? error.message : 'Loading…'}</p></div></div>;
  const open = url => window.open(url, '_blank');
  return <div className="demo-page">
    <div className="demo-head"><Brand /><span className="pill">{d.status.state} · keeper {d.health.keeper_connected ? 'connected' : 'not connected'} · AI {d.health.llm_provider}</span></div>
    <div className="demo-controls">
      <ActionButton className="ghost-sm" onClick={() => act('/demo/reset', 'Vault emptied: ready for the live upload')}><RotateCcw /> Reset (empty vault)</ActionButton>
      <ActionButton className="ghost-sm" onClick={() => act('/demo/load', "Ramesh's data loaded")}><UploadCloud /> Load Ramesh's data</ActionButton>
      <ActionButton className="ghost-sm" onClick={() => act('/demo/miss-deadline', 'Deadline skipped')}><Siren /> Skip to missed check-in</ActionButton>
      {!d.health.keeper_connected && <ActionButton className="ghost-sm" onClick={() => act('/demo/simulate-release', 'Release simulated: beneficiaries notified')}><Gift /> Simulate release</ActionButton>}
    </div>
    <div className="demo-grid">
      <div className="demo-col"><h3><User /> Ramesh (owner)</h3><button className="demo-link" onClick={() => open(location.origin + '/')}>Open Ramesh's app <ArrowUpRight /></button></div>
      <div className="demo-col"><h3><HeartHandshake /> Trusted contacts</h3>
        {d.contacts.length === 0 && <p className="muted small">Add contacts in Ramesh's app, or load Ramesh's data.</p>}
        {d.contacts.map(c => <button key={c.id} className="demo-link" onClick={() => open(localLink(c.invite_url))}>
          <span><b>{c.name}</b><small>{c.relation} · {c.status}</small></span><ArrowUpRight /></button>)}</div>
      <div className="demo-col"><h3><Gift /> Family (beneficiaries)</h3>
        {d.family.length === 0 && <p className="muted small">Assign beneficiaries in Ramesh's app first.</p>}
        {d.family.map(f => <button key={f.name} className="demo-link" onClick={() => open(localLink(f.family_url))}>
          <span><b>{f.name}</b><small>{f.relation} · {f.assets} asset{f.assets === 1 ? '' : 's'} · {f.notified_at ? 'link sent' : 'not told yet'}</small></span><ArrowUpRight /></button>)}</div>
    </div>
    <div className="sms-feed"><h3><MessageSquare /> Messages sent (simulated SMS)</h3>
      {d.notes.length === 0 && <p className="muted small">No messages yet.</p>}
      {d.notes.slice(0, 12).map(n => <div className="sms" key={n.id}><div><b>To {n.to}</b><span>{n.to_phone} · {when(n.timestamp)}</span></div><p>{n.text}</p>
        {n.link && <button className="text-btn" onClick={() => open(localLink(n.link))}>Open link <ArrowUpRight /></button>}</div>)}</div>
  </div>;
}
