// /trusted-contact - where a trusted contact confirms the owner's death.
import { VaultState, describe } from "../../../agent/stateMachine";
import { Address, Card, Row, StateBadge, TxProgress, fmtDuration } from "../components";
import { useTx, useVaultStatus } from "../lib/hooks";
import { sameAddr } from "../lib/vault";
import { useWallet } from "../lib/wallet";

export default function TrustedContact() {
  const { status, now, error, refresh } = useVaultStatus();
  const wallet = useWallet();
  const { tx, busy, run } = useTx(refresh);

  if (!status) return <div className="card">{error ? `Could not read the vault: ${error}` : "Loading vault…"}</div>;

  const d = describe(status, now);
  const myIndex = status.trustedContacts.findIndex((c) => sameAddr(c, wallet.account));
  const isContact = myIndex >= 0;
  const alreadyConfirmed = isContact && status.confirmedBy[myIndex];
  const graceLeft = status.graceDeadline - now;

  // The first rule that fails explains why the button is disabled
  let reason = "";
  if (!wallet.account) reason = "Connect your wallet to confirm.";
  else if (!isContact) reason = "The connected address is not one of the 3 trusted contacts.";
  else if (status.state === VaultState.ACTIVE) reason = "The owner is checking in normally. Nothing to confirm.";
  else if (status.state === VaultState.CONFIRMED) reason = "Already confirmed by 2 contacts. Release is pending.";
  else if (status.state === VaultState.RELEASED) reason = "The vault has already been released.";
  else if (graceLeft >= 0) reason = `Grace period ends in ${fmtDuration(graceLeft)}. The owner gets the full window to respond first.`;
  else if (alreadyConfirmed) reason = "You already confirmed in this round.";

  const canConfirm = reason === "" && !busy;

  return (
    <div className="page narrow">
      {error && <div className="banner">Showing last known data. RPC error: {error}</div>}

      <Card title="Trusted contact confirmation">
        <Row label="Vault state">
          <StateBadge state={status.state} /> <span className="muted">{d.headline}</span>
        </Row>
        <Row label="Owner">
          <Address addr={status.owner} />
        </Row>
        <Row label="Confirmations">
          <strong>{status.confirmationCount} / 2 required</strong>
        </Row>
        {status.trustedContacts.map((c, i) => (
          <Row key={c + i} label={`Contact ${i + 1}`}>
            <Address addr={c} you={i === myIndex} />{" "}
            {status.confirmedBy[i] ? <span className="tag tag-ok">confirmed</span> : <span className="tag">waiting</span>}
          </Row>
        ))}
        {wallet.account && (
          <Row label="Your wallet">
            <Address addr={wallet.account} /> {isContact ? <span className="tag tag-ok">trusted contact {myIndex + 1}</span> : <span className="tag">not a contact</span>}
          </Row>
        )}
      </Card>

      <Card title="Confirm">
        <p className="muted">
          Only confirm if you know the owner has died. Two of the three trusted contacts must confirm. The owner can still cancel during
          the release delay.
        </p>
        <button className="btn btn-danger btn-big" disabled={!canConfirm} onClick={() => run("Confirm owner death", (v, o) => v.confirmDeath(o))}>
          Confirm Owner Death
        </button>
        {reason && <p className="hint">{reason}</p>}
        <TxProgress tx={tx} />
      </Card>
    </div>
  );
}
