// /txlog - every contract event, straight from the chain (real tx hashes only).
import { useEffect, useState } from "react";
import { Card, TxLink, fmtDateTime } from "../components";
import { DEPLOY_BLOCK } from "../config";
import { useEvents } from "../lib/events";

export default function TxLog() {
  const { rows, scanning, lastUpdated, error } = useEvents();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const updated = lastUpdated ? `${Math.round((Date.now() - lastUpdated) / 1000)}s ago` : "never";

  return (
    <div className="page">
      <Card title="Transaction log" right={<span className="muted">auto-refresh 10s · updated {updated}</span>}>
        {error && <div className="banner">Could not load some events: {error}. Retrying automatically.</div>}
        {scanning && rows.length === 0 ? (
          <p className="muted">Scanning events from block {DEPLOY_BLOCK}…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Tx hash</th>
                  <th>Block</th>
                  <th>Status</th>
                  <th>Explorer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtDateTime(r.time)}</td>
                    <td>{r.action}</td>
                    <td>
                      <span className="mono">{r.txHash.slice(0, 10)}…{r.txHash.slice(-6)}</span>
                    </td>
                    <td className="mono">{r.block}</td>
                    {/* Events are only emitted by successful transactions */}
                    <td>
                      <span className="tag tag-ok">SUCCESS</span>
                    </td>
                    <td>{r.explorerUrl ? <TxLink hash={r.txHash} url={r.explorerUrl} /> : <span className="muted">local</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
