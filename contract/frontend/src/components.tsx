// Small shared UI pieces.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATE_INFO, type VaultState } from "../../agent/stateMachine";
import { API_URL, NETWORK, addressUrl } from "./config";
import { short } from "./lib/vault";
import type { AgentStatus, TxState } from "./lib/hooks";

// ---------- formatting ----------

export const fmtDateTime = (ts: number) => (ts ? new Date(ts * 1000).toLocaleString() : "-");

/** 75 -> "1m 15s" */
export function fmtDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** "in 12s" / "5s ago" relative to chain time `now`. */
export function relative(ts: number, now: number) {
  if (!ts || !now) return "";
  const diff = ts - now;
  return diff >= 0 ? `in ${fmtDuration(diff)}` : `${fmtDuration(-diff)} ago`;
}

// ---------- building blocks ----------

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <h2>{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">{label}</div>
      <div className="row-value">{children}</div>
    </div>
  );
}

export function StateBadge({ state, large }: { state: number; large?: boolean }) {
  const info = STATE_INFO[state as VaultState];
  if (!info) return null;
  return (
    <span className={`badge ${large ? "badge-lg" : ""}`} style={{ color: info.color, borderColor: info.color }}>
      <span className="dot" style={{ background: info.color }} />
      {info.name}
    </span>
  );
}

export function Address({ addr, you }: { addr: string; you?: boolean }) {
  const url = addressUrl(addr);
  return (
    <span className="mono" title={addr}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {short(addr)}
        </a>
      ) : (
        short(addr)
      )}
      {you && <span className="you">you</span>}
    </span>
  );
}

export function TxLink({ hash, url }: { hash: string; url?: string | null }) {
  return url ? (
    <a className="mono" href={url} target="_blank" rel="noreferrer" title={hash}>
      {short(hash)} ↗
    </a>
  ) : (
    <span className="mono" title={hash}>
      {short(hash)} <span className="muted">(local)</span>
    </span>
  );
}

/** Submitted -> Confirming -> Confirmed progress for a wallet tx. */
export function TxProgress({ tx }: { tx: TxState }) {
  if (tx.phase === "idle") return null;
  if (tx.phase === "wallet") return <div className="tx tx-info">{tx.label}: approve the transaction in your wallet…</div>;
  if (tx.phase === "failed")
    return (
      <div className="tx tx-error">
        {tx.label} failed: {tx.error}
        {tx.hash && (
          <>
            {" "}
            · <TxLink hash={tx.hash} url={tx.explorerUrl} />
          </>
        )}
      </div>
    );

  const confirmed = tx.phase === "confirmed";
  return (
    <div className={`tx ${confirmed ? "tx-ok" : "tx-info"}`}>
      <div className="steps">
        <span className="step done">✓ Submitted</span>
        <span className={`step ${confirmed ? "done" : "active"}`}>{confirmed ? "✓" : "…"} Confirming</span>
        <span className={`step ${confirmed ? "done" : ""}`}>{confirmed ? "✓" : "○"} Confirmed</span>
      </div>
      <div>
        {tx.label} · <TxLink hash={tx.hash!} url={tx.explorerUrl} />
        {confirmed && <> · block {tx.block}</>}
      </div>
    </div>
  );
}

/** AUTONOMOUS AGENT panel fed by /agent/status. */
export function AgentPanel({ agent, online }: { agent: AgentStatus | null; online: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const nextIn = agent?.nextCheckMs ? Math.max(0, Math.round((agent.nextCheckMs - Date.now()) / 1000)) : null;

  return (
    <Card
      title="Autonomous agent"
      right={<span className={`pill ${online ? "pill-ok" : "pill-bad"}`}>{online ? "🟢 MONITORING" : "🔴 OFFLINE"}</span>}
    >
      {agent ? (
        <>
          <Row label="Last checked">{agent.secondsSinceLastCheck ?? "-"}s ago</Row>
          <Row label="Next check">{online && nextIn !== null ? `in ${nextIn}s` : "-"}</Row>
          <Row label="Keeper">{agent.keeper ? <Address addr={agent.keeper} /> : "-"}</Row>
          <Row label="Contract">{agent.contract ? <Address addr={agent.contract} /> : "-"}</Row>
          <Row label="Network">
            {agent.network} (chain {agent.chainId})
          </Row>
          {agent.txPending && <Row label="Keeper tx">pending…</Row>}
          {agent.lastError && <Row label="Last error"><span className="muted">{agent.lastError}</span></Row>}
        </>
      ) : (
        <p className="muted">Agent API not reachable at {API_URL}. Start it with <code>npm run agent</code>.</p>
      )}
    </Card>
  );
}

// ---------- notification toasts from /notifications ----------

interface Notification {
  id: number;
  time: string;
  title: string;
  message: string;
  explorerUrl?: string;
}

export function Toasts() {
  const [toasts, setToasts] = useState<Notification[]>([]);
  const lastId = useRef<number | null>(null); // null = first load (don't toast history)

  useEffect(() => {
    const load = async () => {
      try {
        const list: Notification[] = await (await fetch(`${API_URL}/notifications`)).json();
        const maxId = list.reduce((m, n) => Math.max(m, n.id), 0);
        if (lastId.current !== null) {
          const fresh = list.filter((n) => n.id > lastId.current!).reverse(); // oldest first
          fresh.forEach((n) => {
            setToasts((t) => [...t, n].slice(-4));
            setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 8000);
          });
        }
        lastId.current = Math.max(lastId.current ?? 0, maxId);
      } catch {
        /* API offline - the agent panel already shows that */
      }
    };
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
          <strong>{t.title}</strong>
          <div>{t.message}</div>
          {t.explorerUrl?.startsWith("http") && (
            <a href={t.explorerUrl} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export const networkLabel = `${NETWORK.chainName} · ${NETWORK.chainId}`;
