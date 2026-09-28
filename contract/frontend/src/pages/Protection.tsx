// /protection - the owner's dashboard.
import { VaultState, describe } from "../../../agent/stateMachine";
import { AgentPanel, Address, Card, Row, StateBadge, TxLink, TxProgress, fmtDateTime, fmtDuration, relative } from "../components";
import { useAgentStatus, useTx, useVaultStatus } from "../lib/hooks";
import { useEvents } from "../lib/events";
import { sameAddr } from "../lib/vault";
import { useWallet } from "../lib/wallet";

export default function Protection() {
  const { status, now, error, refresh } = useVaultStatus();
  const { agent, online } = useAgentStatus();
  const { rows } = useEvents();
  const wallet = useWallet();
  const { tx, busy, run } = useTx(refresh);

  if (!status) return <div className="card">{error ? `Could not read the vault: ${error}` : "Loading vault…"}</div>;

  const d = describe(status, now);
  const isOwner = sameAddr(wallet.account, status.owner);
  const pending = status.state === VaultState.GRACE || status.state === VaultState.CONFIRMED;
  const latestEvent = rows[0];

  // Big countdown for the deadline that matters in this state
  let countdownLabel = "";
  let countdown: number | null = null;
  if (status.state === VaultState.ACTIVE) [countdownLabel, countdown] = ["Next check-in due", status.checkInDeadline - now];
  if (status.state === VaultState.GRACE) [countdownLabel, countdown] = ["Grace period ends", status.graceDeadline - now];
  if (status.state === VaultState.CONFIRMED) [countdownLabel, countdown] = ["Release available", status.releaseAvailableAt - now];

  // Why the owner buttons can't be used right now
  let ownerBlock = "";
  if (!wallet.account) ownerBlock = "Connect the owner wallet to use these controls.";
  else if (wallet.wrongNetwork) ownerBlock = "Your wallet is on the wrong network. It will switch when you click.";
  else if (!isOwner) ownerBlock = "The connected wallet is not the vault owner.";

  return (
    <div className="page">
      {error && <div className="banner">Showing last known data. RPC error: {error}</div>}

      <section className="hero" style={{ borderColor: d.color }}>
        <div>
          <div className="hero-top">
            <StateBadge state={status.state} large />
            <span className="muted">round {status.round}</span>
          </div>
          <h1>{d.headline}</h1>
          <p className="muted">{d.meaning}</p>
          <p className="muted">Next step: {d.nextAction}</p>
        </div>
        {countdown !== null && (
          <div className="countdown">
            <div className="muted">{countdownLabel}</div>
            <div className={`count ${countdown < 0 ? "overdue" : ""}`}>
              {countdown >= 0 ? fmtDuration(countdown) : `-${fmtDuration(-countdown)}`}
            </div>
          </div>
        )}
      </section>

      <div className="grid">
        <Card title="Owner controls">
          <div className="actions">
            <button
              className="btn btn-primary btn-big"
              disabled={!isOwner || busy || status.state === VaultState.RELEASED}
              onClick={() => run("Check-in", (v, o) => v.checkIn(o))}
            >
              I'M STILL HERE
            </button>
            {pending && (
              <button className="btn btn-danger" disabled={!isOwner || busy} onClick={() => run("Cancel release", (v, o) => v.cancel(o))}>
                Cancel release
              </button>
            )}
            {status.state === VaultState.RELEASED && status.demoMode && (
              <button className="btn" disabled={!isOwner || busy} onClick={() => run("Reset demo", (v, o) => v.resetDemo(o))}>
                Reset demo
              </button>
            )}
          </div>
          {ownerBlock && <p className="hint">{ownerBlock}</p>}
          {status.state === VaultState.RELEASED && <p className="hint">The vault is released. Check-in is no longer possible.</p>}
          <TxProgress tx={tx} />
        </Card>

        <AgentPanel agent={agent} online={online} />

        <Card title="Timeline">
          <Row label="Last check-in">
            {fmtDateTime(status.lastCheckIn)} <span className="muted">({relative(status.lastCheckIn, now)})</span>
          </Row>
          <Row label="Check-in deadline">
            {fmtDateTime(status.checkInDeadline)} <span className="muted">({relative(status.checkInDeadline, now)})</span>
          </Row>
          <Row label="Grace deadline">
            {status.graceDeadline ? (
              <>
                {fmtDateTime(status.graceDeadline)} <span className="muted">({relative(status.graceDeadline, now)})</span>
              </>
            ) : (
              "-"
            )}
          </Row>
          <Row label="Release available">
            {status.releaseAvailableAt ? (
              <>
                {fmtDateTime(status.releaseAvailableAt)} <span className="muted">({relative(status.releaseAvailableAt, now)})</span>
              </>
            ) : (
              "-"
            )}
          </Row>
          <Row label="Periods">
            check-in {fmtDuration(status.checkInPeriod)} · grace {fmtDuration(status.gracePeriod)} · delay{" "}
            {fmtDuration(status.releaseDelay)}
            {status.demoMode && <span className="tag">DEMO</span>}
          </Row>
        </Card>

        <Card title="People">
          <Row label="Owner">
            <Address addr={status.owner} you={isOwner} />
          </Row>
          <Row label={`Confirmations`}>
            <strong>{status.confirmationCount} / 2</strong>
          </Row>
          {status.trustedContacts.map((c, i) => (
            <Row key={c + i} label={`Trusted contact ${i + 1}`}>
              <Address addr={c} you={sameAddr(wallet.account, c)} />{" "}
              {status.confirmedBy[i] && <span className="tag tag-ok">confirmed</span>}
            </Row>
          ))}
          {status.beneficiaries.map((b, i) => (
            <Row key={b + i} label={`Beneficiary ${i + 1}`}>
              <Address addr={b} />
            </Row>
          ))}
        </Card>

        <Card title="On-chain record">
          <Row label="Vault hash">
            <span className="mono wrap">{/^0x0+$/.test(status.vaultHash) ? "not set" : status.vaultHash}</span>
          </Row>
          <Row label="Latest event">
            {latestEvent ? (
              <>
                {latestEvent.action} <span className="muted">({fmtDateTime(latestEvent.time)})</span>
              </>
            ) : (
              "-"
            )}
          </Row>
          <Row label="Latest tx">{latestEvent ? <TxLink hash={latestEvent.txHash} url={latestEvent.explorerUrl} /> : "-"}</Row>
          <Row label="Keeper">
            <Address addr={status.keeper} />
          </Row>
        </Card>
      </div>
    </div>
  );
}
