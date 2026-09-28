// A beneficiary's private page, /family/<token>. They receive this link by SMS only when
// the vault is released. Before that the page shows nothing, not even whose vault it is.
// Design by Ananya (her "Beneficiary view"), now driven by the backend.
import React, { useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Circle, Loader2, LockKeyhole } from 'lucide-react';
import { publicApi } from './api.js';
import { Brand, firstName, initials, money, usePoll } from './ui.jsx';

export default function FamilyApp({ token }) {
  const [view, error] = usePoll(() => publicApi(`/family/${token}`), 5000, [token]);
  if (!view) return <div className="family-page"><div className="m-center">{error
    ? <><AlertTriangle /><h2>{error.status === 404 ? 'This link is not valid' : "Can't connect"}</h2><p>{error.status === 404 ? 'Please check the link in your message.' : error.message}</p></>
    : <><Loader2 className="spin" /><p>Opening…</p></>}</div></div>;

  if (!view.released) return <div className="family-page"><div className="m-center locked"><Brand /><LockKeyhole className="big-icon" /><h2>Nothing to show yet</h2><p>{view.message}</p></div></div>;

  return <div className="family-page"><div className="page">
    <div className="beneficiary-hero"><Brand /><span>LEFT FOR YOU BY {view.owner_name.toUpperCase()}</span><h1>Hello, {firstName(view.beneficiary)}</h1>
      <p>{view.owner_name} asked Amanat to keep this safe for you until now. We'll guide you through every step.</p>
      <div><small>TOTAL VALUE ASSIGNED TO YOU</small><strong>{money(view.total_value)}</strong><em>Across {view.assets.length} asset{view.assets.length === 1 ? '' : 's'}</em></div></div>
    <div className="released-note"><CheckCircle2 /><div><b>Released after 2 of 3 trusted contacts confirmed.</b><span>This page is private to you. Keep the link safe.</span></div></div>
    <div className="section-head"><div><span>YOUR INHERITANCE</span><h3>Assets assigned to you</h3></div></div>
    <div className="claim-grid">{view.assets.map(a => <ClaimCard key={a.id} asset={a} token={token} />)}</div>
  </div></div>;
}

function ClaimCard({ asset, token }) {
  const [guide, error] = usePoll(() => publicApi(`/family/${token}/claim/${asset.id}`), 0, [token, asset.id]);
  const [done, setDone] = useState([]);
  const steps = guide?.steps || [];
  return <div className="claim-card">
    <div className="claim-head"><div className="asset-logo">{initials(asset.institution)}</div><div><span>{asset.institution}</span><h3>{asset.asset_type}</h3><p className="mono">{asset.account_number}</p></div><span className="pill">{asset.your_share}% share</span></div>
    <div className="your-value"><span>VALUE ASSIGNED TO YOU</span><strong>{money(asset.your_value)}</strong></div>
    <div className="checklist"><span>CLAIM CHECKLIST</span>
      {!guide && !error && <p className="muted small"><Loader2 className="spin" /> Loading steps…</p>}
      {(error || (guide && steps.length === 0)) && <p className="muted small">The step-by-step guide for this asset isn't ready yet. Contact {asset.institution} with the death certificate, your ID and this account number.</p>}
      {steps.map((s, i) => <label key={i} onClick={() => setDone(d => d.includes(i) ? d.filter(x => x !== i) : [...d, i])} className={done.includes(i) ? 'done' : ''}>
        <i>{i + 1}</i><span>{s}</span>{done.includes(i) ? <CheckCircle2 className="ok" /> : <Circle />}</label>)}
      {guide?.documents?.length > 0 && <p className="muted small"><b>Documents:</b> {guide.documents.join(', ')}</p>}
      {guide?.disclaimer && <p className="muted tiny">{guide.disclaimer}</p>}
    </div>
    {guide?.sources?.[0]?.startsWith('http') && <a className="claim-btn" href={guide.sources[0]} target="_blank" rel="noreferrer">Official claim page <ArrowUpRight /></a>}
  </div>;
}
