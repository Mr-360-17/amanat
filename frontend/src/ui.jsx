// Small shared pieces used by every view.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = n => inr.format(Number(n || 0));
export const firstName = name => (name || '').trim().split(/\s+/)[0] || '';
export const initials = name => (name || '?').split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase();
export const when = iso => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export const CATEGORY = {
  'Savings Account': 'Bank', 'Current Account': 'Bank', 'Fixed Deposit': 'Bank', 'Recurring Deposit': 'Bank',
  'Life Insurance': 'Insurance', 'Health Insurance': 'Insurance',
  EPF: 'PF', PPF: 'PF', NPS: 'PF',
  'Mutual Fund': 'Investments', Shares: 'Investments', Bonds: 'Investments',
};

export function Brand({ small }) {
  return <div className={small ? 'phone-brand' : 'beneficiary-brand'}><div className="brandmark">अ</div>Amanat</div>;
}

export function PageTitle({ eyebrow, title, sub, action }) {
  return <div className="page-title"><div><span>{eyebrow}</span><h1>{title}</h1><p>{sub}</p></div>{action}</div>;
}

// Re-run `load` now and every `ms`. Returns [data, error, reload].
export function usePoll(load, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const run = useCallback(async () => {
    try { const d = await load(); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    alive.current = true;
    run();
    const t = ms ? setInterval(run, ms) : null;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [run, ms]);
  return [data, error, run];
}

// Toasts: const toast = useToast(); toast.ok('Saved'); toast.err(e)
const ToastCtx = React.createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((kind, text) => {
    const id = Math.random();
    setItems(xs => [...xs, { id, kind, text }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  const api = useRef({ ok: t => push('ok', t), err: e => push('err', e?.message || String(e)) });
  return <ToastCtx.Provider value={api.current}>{children}
    <div className="toasts">{items.map(t => <div key={t.id} className={`toast ${t.kind}`}>
      {t.kind === 'ok' ? <CheckCircle2 /> : <AlertTriangle />}<span>{t.text}</span>
      <button onClick={() => setItems(xs => xs.filter(x => x.id !== t.id))}><X /></button></div>)}</div>
  </ToastCtx.Provider>;
}
export const useToast = () => React.useContext(ToastCtx);

// Button that disables itself while its async action runs, and reports errors.
export function ActionButton({ onClick, children, className = 'primary', disabled, busyText }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return <button className={className} disabled={disabled || busy} onClick={async () => {
    setBusy(true);
    try { await onClick(); } catch (e) { toast.err(e); } finally { setBusy(false); }
  }}>{busy && busyText ? busyText : children}</button>;
}

export function Countdown({ to }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!to) return <div className="countdown"><b>--<small>DAYS</small></b><i>:</i><b>--<small>HOURS</small></b><i>:</i><b>--<small>MIN</small></b><i>:</i><b>--<small>SEC</small></b></div>;
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const p = n => String(n).padStart(2, '0');
  return <div className="countdown"><b>{p(d)}<small>DAYS</small></b><i>:</i><b>{p(h)}<small>HOURS</small></b><i>:</i><b>{p(m)}<small>MIN</small></b><i>:</i><b>{p(s)}<small>SEC</small></b></div>;
}
