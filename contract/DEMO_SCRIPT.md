# LegacyVault demo script (3–4 minutes)

Two scenarios with **real transactions**, driven by the UI and the autonomous keeper:

1. **Recovery.** The owner misses a check-in, the keeper starts grace, the owner returns, and the vault is safe again.
2. **Release.** The owner misses a check-in, the keeper starts grace, 2 of 3 contacts confirm, and the keeper releases.

Demo timers: check-in **30 s**, grace **30 s**, release delay **15 s**. Recovery first: it flows
straight into the release scenario without a reset.

---

## Before the judges arrive (10 min earlier)

- [ ] `.env` has `NETWORK=mst` (or `local` as fallback). Owner, keeper and contacts have gas (`npm run fund`).
- [ ] **Terminal 1:** `npm run agent` shows "LEGACYVAULT AUTONOMOUS KEEPER" and `[keeper] block …` lines.
- [ ] **Terminal 2:** `npm run frontend`. Open http://localhost:5173/protection.
- [ ] **Browser profile A** (owner wallet) on `/protection`. **Profile B** (contact 1 + contact 2 accounts) on `/trusted-contact`.
- [ ] Both wallets connected, on the right network (the site switches automatically).
- [ ] Vault is **ACTIVE**. If not: `npm run vault -- reset` (from RELEASED) or `npm run vault -- cancel` (from GRACE/CONFIRMED).
- [ ] Agent panel shows **🟢 MONITORING**. Open `/txlog` and MSTScan in spare tabs.
- [ ] Keep the owner checking in (**I'M STILL HERE**) every ~20 s while you wait, so the vault stays ACTIVE until you start.

**Backup plan:** if a wallet misbehaves, run `npm run scenario:recovery` / `npm run scenario:release`
in a terminal. The same flows run from CLI wallets, and the UI still updates live.

---

## Script

### 0:00 – The problem (20 s)
> "When someone dies, their family often can't access the digital information they left behind.
> The hard part isn't storing it. It's deciding **fairly** that it's time to release it, without trusting
> one person or company, and without releasing it by mistake. LegacyVault puts that decision in a
> smart contract on MST, with an autonomous agent that enforces the timeline."

### 0:20 – The dashboard + a check-in (60 s), `/protection`, profile A
Click **I'M STILL HERE**. Show *Submitted → Confirming → Confirmed* and the tx link. The countdown resets to 30 s.
> "The owner checks in regularly. In real use that's every 30 days; for the demo it's 60 seconds.
> That was a real transaction on MST."
Point at: **ACTIVE** badge, trusted contacts, beneficiaries, vault hash, **AUTONOMOUS AGENT 🟢 MONITORING**.
> "Only addresses, timestamps and a hash are on-chain. No personal data, and no money."

### 0:50 – Missed check-in → keeper acts (20 s)
Don't click anything. Let the countdown hit zero.
> "The owner stops checking in. Nobody has to press a button. The agent watches the chain every
> 5 seconds, using **block time**, not a laptop clock."

A toast appears: **🚨 CHECK-IN MISSED**, then **⏳ GRACE PERIOD STARTED**. The badge turns amber: **GRACE**.
> "The agent sent that transaction itself. Here's the hash. But the owner still has a grace period."

### 1:10 – Scenario 1: recovery (20 s)
Click **I'M STILL HERE** while the grace countdown is still running (you have about 30 s). Show *Submitted → Confirming → Confirmed* with the tx link.
> "Maybe they were just on holiday. One click, and the vault is back to ACTIVE. Any half-finished
> confirmations are wiped, because the contract starts a new round."

Toast: **🛡️ OWNER IS ALIVE - RELEASE CANCELLED**.

### 1:30 – Scenario 2: release (miss again, 30 s)
Don't click. While the countdown runs:
> "Now imagine the owner really has passed away. The agent will start grace again. Trusted contacts
> **cannot** confirm during grace. The owner always gets the full window first."

Switch to **profile B → `/trusted-contact`**. The button is **disabled**, with the reason "Grace period ends in …s".

### 2:15 – Grace ends → contacts confirm (20 s)
When the button enables, click **Confirm Owner Death** as **contact 1**. It shows **1 / 2**.
> "One contact isn't enough. That protects against a mistake or one bad actor."

Switch to the **contact 2** account and confirm. It shows **2 / 2 → CONFIRMED**.
> "Two of three agree. Even now there's a safety delay, so a living owner can still cancel if two contacts collude."

### 2:35 – Keeper releases (20 s)
_Timing check: last check-in about 1:10 → deadline 1:40 → keeper starts grace by about 1:45 → grace ends about 2:15 →
confirmations about 2:15–2:30 → release by about 2:50. On MST (about 2 s blocks) each automatic step can land 5–10 s later;
measured: miss → release takes about 2 min. Keep the proof and close short if you're running late. Fill any wait with the narration above._
Back on `/protection`: countdown "Release available". After about 15 s: toast **🚀 VAULT RELEASED**, badge **RELEASED**.
> "The agent released it automatically. That on-chain state is the signal for our backend to hand over
> the encrypted vault, and the stored hash proves nothing was tampered with."

### 2:55 – Proof (25 s), `/txlog` + MSTScan
> "Every step is a real transaction on MST: check-ins, the agent's grace and release, both confirmations.
> Anyone can audit who did what, and when."
Click one explorer link, ideally the keeper's `release` tx, to show it on MSTScan.

### 3:20 – Close (15 s)
> "Rules nobody can bend, an agent that never sleeps but can't cheat, and a human safety net at every step.
> That's LegacyVault."

**Total: about 3:35.** After the demo, the owner clicks **Reset demo** to be ready for the next judge.
