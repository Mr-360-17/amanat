// A trusted contact's page, opened from the SMS link /circle/<token> on their own phone.
// No owner key: the token in the link is their credential.
import React, { useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, Clock3, HeartPulse, Loader2, LockKeyhole, MapPin, Phone,
  ShieldCheck, Siren, Stethoscope, UsersRound, X,
} from 'lucide-react';
import { publicApi } from './api.js';
import { ActionButton, Brand, firstName, initials, usePoll, useToast, when } from './ui.jsx';

export default function ContactApp({ token }) {
  const [view, error, refresh] = usePoll(() => publicApi(`/circle/${token}`), 4000, [token]);
  if (!view) return <Mobile>{error ? <Problem error={error} /> : <Loading />}</Mobile>;
  const { contact, owner_name: owner, card } = view;
  return <Mobile>
    <div className="m-head"><Brand small /><span className={`pill ${contact.status === 'accepted' ? 'green' : ''}`}>{contact.status === 'accepted' ? 'Trusted contact' : 'Invitation'}</span></div>
    {contact.status !== 'accepted'
      ? <Invite view={view} token={token} refresh={refresh} />
      : <>
        <EmergencyPanel view={view} token={token} refresh={refresh} />
        {view.reachability === 'awaiting_response' && <div className="m-card highlight"><b>Are you still reachable on this number?</b>
          <p>{firstName(owner)} asked Amanat to check that the circle can still be reached.</p>
          <ActionButton onClick={async () => { await publicApi(`/circle/${token}/ping`, { method: 'POST' }); refresh(); }}><Check /> Yes, I'm reachable</ActionButton></div>}
        <Card card={card} owner={owner} />
        <DeathConfirm owner={owner} token={token} />
      </>}
  </Mobile>;
}

const Mobile = ({ children }) => <div className="mobile-page"><div className="mobile-inner">{children}</div></div>;
const Loading = () => <div className="m-center"><Loader2 className="spin" /><p>Opening…</p></div>;
const Problem = ({ error }) => <div className="m-center"><AlertTriangle /><h2>{error.status === 404 ? 'This link is not valid' : "Can't connect"}</h2>
  <p>{error.status === 404 ? 'Ask the person who invited you to send the link again.' : error.message}</p></div>;

function Invite({ view, token, refresh }) {
  const toast = useToast();
  const respond = async accept => {
    await publicApi(`/circle/${token}/${accept ? 'accept' : 'decline'}`, { method: 'POST' });
    toast.ok(accept ? 'Thank you. You are now a trusted contact.' : 'You declined.');
    refresh();
  };
  const declined = view.contact.status === 'declined';
  return <div className="m-card invite">
    <div className="avatar big">{initials(view.owner_name)}</div>
    <h1>{declined ? 'You declined' : `${view.owner_name} trusts you`}</h1>
    <p>{declined ? `${firstName(view.owner_name)} will choose someone else. Changed your mind? You can still accept.` : view.message}</p>
    <ul className="m-points">
      <li><ShieldCheck /> You'll never see amounts or account numbers.</li>
      <li><UsersRound /> Nothing can happen on your word alone: 2 of 3 must agree.</li>
      <li><Clock3 /> You'll only be asked if {firstName(view.owner_name)} stops checking in.</li>
    </ul>
    <ActionButton className="primary large" onClick={() => respond(true)}><Check /> Accept</ActionButton>
    {!declined && <ActionButton className="ghost" onClick={() => respond(false)}>I can't take this on</ActionButton>}
  </div>;
}

function Card({ card, owner }) {
  const first = firstName(owner);
  return <>
    <div className="m-card"><span className="eyebrow">EMERGENCY CARD</span>
      <div className="identity"><div className="avatar">{initials(owner)}</div><div><b>{card.owner.name}</b><span>{card.owner.blood_group ? `Blood group ${card.owner.blood_group}` : 'Vault owner'}</span></div>
        {card.owner.phone && <a className="call" href={`tel:${card.owner.phone}`}><Phone /></a>}</div>
      {card.owner.address && <p className="m-line"><MapPin /> {card.owner.address}</p>}
      {card.note && <p className="m-note">“{card.note}”</p>}
    </div>
    {(card.family.length > 0 || card.doctor) && <div className="m-card"><span className="eyebrow">WHO TO CALL</span>
      {card.family.map(f => <Person key={f.name} p={f} sub={f.relation} />)}
      {card.doctor && <Person p={card.doctor} sub="Family doctor" icon={<Stethoscope />} />}</div>}
    <div className="m-card"><span className="eyebrow">THE CIRCLE</span>
      {card.circle.map(c => <Person key={c.name} p={c} sub={`${c.relation}${c.you ? ' · you' : ''}`} badge={c.status === 'accepted' ? <CheckCircle2 className="ok" /> : <Clock3 className="muted" />} />)}</div>
    {card.assets_held_at.length > 0 && <div className="m-card"><span className="eyebrow">WHERE {first.toUpperCase()}'S ASSETS ARE HELD</span>
      <div className="m-tags">{card.assets_held_at.map((a, i) => <span key={i}>{a.institution}{a.asset_type ? ` · ${a.asset_type}` : ''}</span>)}</div>
      <p className="m-privacy"><LockKeyhole /> {card.privacy_note}</p></div>}
    <div className="m-card"><span className="eyebrow">WHAT TO DO</span><ol className="m-steps">{card.what_to_do.map(s => <li key={s}>{s}</li>)}</ol></div>
  </>;
}

function Person({ p, sub, badge, icon }) {
  return <div className="m-person"><div className="avatar soft">{icon || initials(p.name)}</div><div><b>{p.name}</b><span>{sub}</span></div>
    {badge}{p.phone && <a className="call" href={`tel:${p.phone}`}><Phone /></a>}</div>;
}

function EmergencyPanel({ view, token, refresh }) {
  const em = view.emergency;
  const first = firstName(view.owner_name);
  const me = view.contact.name;
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const post = async (path, body, ok) => { await publicApi(`/circle/${token}/${path}`, { method: 'POST', body }); toast.ok(ok); refresh(); };

  if (em.status === 'active') {
    const acc = view.emergency_access;
    return <div className="m-card emergency"><div className="m-em-head"><Siren /><div><b>Emergency access open</b><span>{em.reason} · confirmed by {em.confirmed_by.join(' & ')}</span></div></div>
      {acc.health_cover.map((h, i) => <div className="m-access" key={i}><HeartPulse /><div><b>{h.insurer}</b><span>Policy {h.policy_number || '-'}{h.sum_insured ? ` · cover ₹${Number(h.sum_insured).toLocaleString('en-IN')}` : ''}</span>
        {h.helpline && <a href={`tel:${h.helpline}`}>Call helpline {h.helpline}</a>}</div></div>)}
      <div className="m-med">{[['Blood group', acc.blood_group], ['Allergies', acc.medical.allergies], ['Conditions', acc.medical.conditions], ['Medications', acc.medical.medications]].filter(([, v]) => v)
        .map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      {acc.doctor && <Person p={acc.doctor} sub="Family doctor" icon={<Stethoscope />} />}
      <p className="m-privacy"><LockKeyhole /> {acc.note}</p></div>;
  }
  if (em.status === 'reported') {
    const mine = em.confirmed_by.includes(me);
    return <div className="m-card emergency"><div className="m-em-head"><Siren /><div><b>{em.reported_by === me ? 'You reported an emergency' : `${em.reported_by} reported an emergency`}</b><span>“{em.reason}” · {when(em.reported_at)}</span></div></div>
      <p>{em.confirmations} of {em.confirmations_required} confirmations. {first} has been alerted and can cancel by checking in.</p>
      {!mine && <ActionButton className="danger" onClick={() => post('emergency/confirm', undefined, 'Confirmed')}><Check /> I can confirm this</ActionButton>}
      {mine && <p className="muted small">Waiting for one more person in the circle to confirm.</p>}</div>;
  }
  return <div className="m-card">
    {['cancelled', 'resolved'].includes(em.status) && <p className="m-ok"><CheckCircle2 /> {first} checked in and is OK.</p>}
    {!open ? <button className="ghost em-btn" onClick={() => setOpen(true)}><Siren /> Something has happened to {first}</button>
      : <><b>What has happened?</b><p className="muted small">{first} is alerted immediately. If another contact confirms, the circle gets {first}'s health cover and medical details. Nothing else.</p>
        <input className="field" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Admitted to hospital" />
        <div className="btn-row"><button className="ghost-sm" onClick={() => setOpen(false)}><X /> Cancel</button>
          <ActionButton className="danger" disabled={!reason.trim()} onClick={() => post('emergency', { reason }, `Reported. ${first} and the circle have been alerted.`)}><Siren /> Report</ActionButton></div></>}
  </div>;
}

function DeathConfirm({ owner, token }) {
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const first = firstName(owner);
  if (result) return <div className="m-card"><div className="confirmed-icon"><Check /></div><h2>Confirmation recorded</h2>
    <p>{result}</p></div>;
  return <div className="m-card danger-zone"><span className="eyebrow">ONLY IF {first.toUpperCase()} HAS PASSED AWAY</span>
    {step === 0 ? <button className="ghost" onClick={() => setStep(1)}>Confirm {first}'s passing…</button>
      : <><div className="alert-icon"><AlertTriangle /></div><h2>Confirm {owner}'s passing?</h2>
        <p>This is a serious declaration. Confirm only if you know it to be true. It is recorded with your name and time, and nothing is released unless a second trusted contact also confirms.</p>
        <ActionButton className="danger" onClick={async () => {
          const r = await publicApi(`/circle/${token}/confirm`, { method: 'POST' });
          setResult(r.ok ? 'Thank you. One more trusted contact must independently confirm before anything is released.'
            : `Your confirmation could not be recorded on-chain yet: ${r.error || 'the blockchain keeper is not connected'}.`);
        }}>Yes, I confirm</ActionButton>
        <button className="ghost" onClick={() => setStep(0)}>Go back</button></>}
  </div>;
}
