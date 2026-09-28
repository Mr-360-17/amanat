// Adapter for the Amanat team backend (backend/amanat/bridges.py).
// Speaks the interface in amanat/contract/README.md on its own port (default 8100),
// with response shapes matching shared/mock/status.json and shared/mock/txlog.json.
//
// Security: the backend calls these routes WITHOUT any auth header, so by default the
// adapter only listens on 127.0.0.1. If the backend runs on another laptop, set
// ADAPTER_HOST=0.0.0.0 and ADAPTER_ALLOWED_IPS=<that laptop's IP>.
//
// Privacy: names / relations / phones are NEVER put on-chain. Contact names and relations
// are kept in agent/data/circle.json (gitignored) only so /status can show them.
import * as fs from "fs";
import * as path from "path";
import express from "express";
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS, NETWORK, CHAIN_ID, EXPLORER_URL, DATA_DIR, provider, txOverrides, decodeRevert } from "./config";
import { STATE_NAMES } from "./stateMachine";
import { storeVaultHash, ContractRefused } from "./keeper";
import { latestNotifications } from "./notifier";
import { getEvents, explorerTx, type ChainEvent } from "./chainlog";

const ADAPTER_PORT = Number(process.env.ADAPTER_PORT || 8100);
const ADAPTER_HOST = (process.env.ADAPTER_HOST || "127.0.0.1").trim();
const ALLOWED_IPS = (process.env.ADAPTER_ALLOWED_IPS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CIRCLE_PATH = path.join(DATA_DIR, "circle.json");

const readVault = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_HASH = /^0x0{64}$/;

// ---------- helpers ----------

/** Unix seconds -> "2026-09-28T18:00:00Z" (same format as the mocks). */
const iso = (ts: number) => (ts ? new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") : null);

interface CircleEntry {
  index: number;
  name: string | null;
  relation: string | null;
  wallet: string | null;
  status: string | null;
}

function readCircle(): CircleEntry[] {
  try {
    return JSON.parse(fs.readFileSync(CIRCLE_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeCircle(entries: CircleEntry[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CIRCLE_PATH, JSON.stringify(entries, null, 2));
}

async function onChainStatus() {
  const [s, block] = await Promise.all([readVault.getStatus(), provider.getBlock("latest")]);
  const contacts: string[] = [...s.trustedContacts];
  const confirmedBy: boolean[] = await Promise.all(
    contacts.map((c) => (c === ethers.ZeroAddress ? false : readVault.hasConfirmedThisRound(c)))
  );
  return { s, now: block!.timestamp, contacts, confirmedBy };
}

/** Plain-English one-liner + the team's event names for each contract event. */
function toTxRow(e: ChainEvent, contacts: string[]) {
  const a = e.args;
  const contactNo = (addr: string) => {
    const i = contacts.findIndex((c) => c.toLowerCase() === String(addr).toLowerCase());
    return i >= 0 ? `#${i + 1}` : String(addr).slice(0, 10);
  };
  let event = e.name;
  let details = e.name;
  switch (e.name) {
    case "CheckIn":
      event = "CheckedIn";
      details = `Owner checked in; next deadline ${iso(Number(a.nextDeadline))}`;
      break;
    case "GraceStarted":
      details = `Check-in missed; grace period until ${iso(Number(a.graceDeadline))}`;
      break;
    case "TrustedContactConfirmed":
      event = "ContactConfirmed";
      details = `Trusted contact ${contactNo(a.contact)} confirmed (${a.count} of 2)`;
      break;
    case "DeathConfirmed":
      details = `2 of 3 contacts confirmed; release available ${iso(Number(a.releaseAvailableAt))}`;
      break;
    case "VaultReleased":
      event = "Released";
      details = "Vault released to the family";
      break;
    case "VaultCancelled":
      event = "Cancelled";
      details = `Back to active: ${a.reason}`;
      break;
    case "VaultHashStored":
      details = `Vault hash ${String(a.vaultHash).slice(0, 12)}... committed on-chain`;
      break;
    case "TrustedContactsUpdated":
      event = "TrustedContactsSet";
      details = "3 trusted contact wallets registered";
      break;
    case "BeneficiariesUpdated":
      event = "BeneficiariesSet";
      details = `${(a.beneficiaries as string[]).length} beneficiary wallets registered`;
      break;
  }
  return { event, tx_hash: e.txHash, timestamp: iso(e.timestamp), explorer_url: explorerTx(e.txHash), details };
}

/** Normalise "::ffff:10.0.0.5" -> "10.0.0.5". */
const clientIp = (req: express.Request) => (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const isLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1";

// ---------- app ----------

const app = express();
app.use(express.json({ limit: "50kb" }));

// Only localhost + explicitly allowed IPs may call the adapter
app.use((req, res, next) => {
  const ip = clientIp(req);
  if (isLoopback(ip) || ALLOWED_IPS.includes(ip)) return next();
  console.log(`[adapter] refused ${req.method} ${req.path} from ${ip}`);
  res.status(403).json({ error: "This keeper only accepts calls from the Amanat backend" });
});

app.get("/status", async (_req, res) => {
  try {
    const { s, now, contacts, confirmedBy } = await onChainStatus();
    const circle = readCircle();
    const state = Number(s.state);
    res.json({
      state: STATE_NAMES[state],
      last_check_in: iso(Number(s.lastCheckIn)),
      next_deadline: iso(Number(s.checkInDeadline)),
      grace_ends: state === 1 ? iso(Number(s.graceDeadline)) : null,
      release_at: Number(s.releaseAvailableAt) ? iso(Number(s.releaseAvailableAt)) : null,
      confirmations: Number(s.confirmationCount),
      confirmations_required: 2,
      trusted_contacts: contacts.map((wallet, i) => {
        const c = circle.find((x) => x.index === i);
        return {
          index: i,
          name: c?.name ?? `Trusted contact ${i + 1}`,
          relation: c?.relation ?? null,
          wallet,
          confirmed: confirmedBy[i],
        };
      }),
      vault_hash: ZERO_HASH.test(s.vaultHash) ? null : s.vaultHash,
      // extras (not in the mock, safe to ignore)
      round: Number(s.round),
      chain_time: iso(now),
      network: NETWORK,
      chain_id: CHAIN_ID,
      contract: CONTRACT_ADDRESS,
      contract_url: EXPLORER_URL ? `${EXPLORER_URL}/address/${CONTRACT_ADDRESS}` : null,
      demo_mode: s.demoMode,
    });
  } catch (e: any) {
    res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
});

app.get("/txlog", async (_req, res) => {
  try {
    const [events, { contacts }] = await Promise.all([getEvents(), onChainStatus()]);
    const rows: any[] = events.map((e) => toTxRow(e, contacts));
    // Reminders are off-chain (keeper notifications), shown with tx_hash null
    for (const n of latestNotifications(200)) {
      if (n.type === "reminder") {
        rows.push({ event: "ReminderSent", tx_hash: null, timestamp: n.time.replace(/\.\d{3}Z$/, "Z"), explorer_url: null, details: n.message });
      }
    }
    rows.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))); // oldest first, like the mock
    res.json(rows);
  } catch (e: any) {
    res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
});

/** Store the hash on-chain via the keeper. Skips the tx if it's already the current hash. */
async function commitHash(hash: unknown, res: express.Response) {
  if (typeof hash !== "string" || !HASH_RE.test(hash) || ZERO_HASH.test(hash)) {
    return res.status(400).json({ error: "hash must be 0x followed by 64 hex characters (not all zeros)" });
  }
  const current: string = await readVault.vaultHash();
  if (current.toLowerCase() === hash.toLowerCase()) {
    return res.json({ ok: true, unchanged: true, hash });
  }
  try {
    const r = await storeVaultHash(hash, 60_000);
    return res.status(r.status === "SUCCESS" ? 200 : 502).json({ ok: r.status === "SUCCESS", hash, tx_hash: r.hash, block: r.block, explorer_url: explorerTx(r.hash) });
  } catch (e: any) {
    if (e instanceof ContractRefused) return res.status(409).json({ error: `Contract refused: ${e.message}` });
    if (e?.message === "KEEPER_BUSY") return res.status(503).json({ error: "Keeper busy, try again shortly" });
    return res.status(502).json({ error: `Transaction failed: ${e?.shortMessage || e?.message}` });
  }
}

app.post("/vault-hash", (req, res) => {
  commitHash(req.body?.hash, res).catch((e) => res.status(502).json({ error: String(e?.message || e) }));
});

app.post("/activate", async (req, res) => {
  try {
    const { s, contacts } = await onChainStatus();
    if (Number(s.state) === 3) return res.status(409).json({ error: "Vault is RELEASED; the owner must reset it first" });
    // (getStatus() has no contactsSet field, so check the wallets themselves)
    if (contacts.some((c) => c === ethers.ZeroAddress)) {
      return res.status(409).json({ error: "Trusted contacts are not registered on-chain yet" });
    }
    // The vault is protected from deployment; activating = making sure the latest hash is committed
    const hash = req.body?.vault_hash;
    if (hash) return commitHash(hash, res);
    return res.json({ ok: true, state: STATE_NAMES[Number(s.state)], note: "Protection is active on-chain" });
  } catch (e: any) {
    res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
});

app.post("/contacts", async (req, res) => {
  const list = req.body?.contacts;
  if (!Array.isArray(list) || list.length !== 3) return res.status(400).json({ error: "contacts must be a list of exactly 3" });
  try {
    const { contacts } = await onChainStatus();
    // Keep only what /status displays: no phone numbers stored here
    const entries: CircleEntry[] = list.map((c: any, i: number) => ({
      index: Number.isInteger(c?.index) ? c.index : i,
      name: typeof c?.name === "string" ? c.name.slice(0, 80) : null,
      relation: typeof c?.relation === "string" ? c.relation.slice(0, 80) : null,
      wallet: typeof c?.wallet === "string" && ethers.isAddress(c.wallet) ? ethers.getAddress(c.wallet) : null,
      status: typeof c?.status === "string" ? c.status : null,
    }));
    writeCircle(entries);
    const mismatches = entries
      .filter((e) => e.wallet && contacts[e.index] && e.wallet.toLowerCase() !== contacts[e.index].toLowerCase())
      .map((e) => ({ index: e.index, backend_wallet: e.wallet, on_chain_wallet: contacts[e.index] }));
    res.json({
      ok: true,
      stored_off_chain: true,
      on_chain_updated: false,
      note: "Names stay off-chain. On-chain contact wallets are changed by the owner wallet (not enabled in this adapter).",
      on_chain_contacts: contacts,
      wallet_mismatches: mismatches,
    });
  } catch (e: any) {
    res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
});

app.post("/contact-status", (req, res) => {
  const index = req.body?.contact_index;
  const status = req.body?.status;
  if (![0, 1, 2].includes(index) || !["accepted", "declined"].includes(status)) {
    return res.status(400).json({ error: "contact_index must be 0-2 and status accepted|declined" });
  }
  const circle = readCircle();
  const entry = circle.find((c) => c.index === index);
  if (entry) entry.status = status;
  else circle.push({ index, name: null, relation: null, wallet: null, status });
  writeCircle(circle);
  res.json({ ok: true, stored_off_chain: true, on_chain_updated: false, note: "On-chain acceptRole() needs a contract upgrade (planned)." });
});

app.post("/beneficiaries", (req, res) => {
  if (typeof req.body?.asset_id !== "string" || !Array.isArray(req.body?.beneficiaries)) {
    return res.status(400).json({ error: "asset_id and beneficiaries[] are required" });
  }
  // Names and shares are personal/financial data: they never go on-chain and aren't stored here.
  res.json({ ok: true, on_chain_updated: false, note: "Beneficiary names and shares stay in the backend; the chain only stores beneficiary wallets." });
});

// ---------- custodial signing (DEMO ONLY, opt-in with ADAPTER_CUSTODIAL=true) ----------
// The team backend calls /checkin and /confirm for the owner and the contacts, so for the
// testnet demo the keeper process signs with their throwaway keys from .env.
// In production each person signs with their own wallet and these routes stay disabled.

const CUSTODIAL = (process.env.ADAPTER_CUSTODIAL || "").trim().toLowerCase() === "true";
const walletBusy = new Set<string>(); // one tx at a time per wallet (no nonce clashes)

/** Friendly text for the contract's custom errors. */
const REFUSAL_TEXT: Record<string, string> = {
  InvalidState: "Not allowed in the vault's current state",
  GraceNotOver: "The grace period hasn't ended yet; the owner gets the full window first",
  AlreadyConfirmed: "This contact already confirmed in this round",
  NotTrustedContact: "This wallet is not one of the 3 trusted contacts",
  NotOwner: "Only the vault owner can do this",
};

function envWallet(keyName: string): ethers.Wallet | null {
  const key = (process.env[keyName] || "").trim();
  return key ? new ethers.Wallet(key, provider) : null;
}

/** Sign + send one vault call as `wallet`, wait for the block, and answer the backend. */
async function sendAs(res: express.Response, label: string, wallet: ethers.Wallet, call: (v: ethers.Contract, o: object) => Promise<ethers.TransactionResponse>) {
  if (walletBusy.has(wallet.address)) return res.status(503).json({ error: `${label}: a previous transaction from this wallet is still pending` });
  walletBusy.add(wallet.address);
  try {
    const vault = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    let tx: ethers.TransactionResponse;
    try {
      tx = await call(vault, await txOverrides());
    } catch (e) {
      const d = decodeRevert(e, vault.interface);
      if (d.name) return res.status(409).json({ error: `${REFUSAL_TEXT[d.name] ?? "Contract refused"} (${d.text})`, contract_error: d.name });
      throw e;
    }
    const receipt = await tx.wait(1, 55_000); // backend waits 60 s
    const ok = receipt?.status === 1;
    console.log(`[adapter] ${label} from ${wallet.address}: ${tx.hash} block ${receipt?.blockNumber} ${ok ? "SUCCESS" : "FAILED"}`);
    return res.status(ok ? 200 : 502).json({ ok, action: label, tx_hash: tx.hash, block: receipt?.blockNumber, explorer_url: explorerTx(tx.hash) });
  } catch (e: any) {
    return res.status(502).json({ error: `${label} failed: ${e?.shortMessage || e?.message}` });
  } finally {
    walletBusy.delete(wallet.address);
  }
}

function custodialOff(res: express.Response, what: string) {
  return res.status(501).json({
    error: `${what} must be signed by the owner/contact wallet. Keeper-side (custodial) signing is off (set ADAPTER_CUSTODIAL=true for the demo).`,
  });
}

app.post("/checkin", async (_req, res) => {
  if (!CUSTODIAL) return custodialOff(res, "Check-in");
  const owner = envWallet("OWNER_PRIVATE_KEY");
  if (!owner) return res.status(500).json({ error: "OWNER_PRIVATE_KEY missing in the keeper's .env" });
  // In GRACE/CONFIRMED the contract treats a check-in as "I'm alive": it cancels and starts a new round
  return sendAs(res, "checkIn", owner, (v, o) => v.checkIn(o));
});

app.post("/confirm", async (req, res) => {
  if (!CUSTODIAL) return custodialOff(res, "Death confirmation");
  const index = req.body?.contact_index;
  if (![0, 1, 2].includes(index)) return res.status(400).json({ error: "contact_index must be 0, 1 or 2" });
  const wallet = envWallet(`CONTACT${index + 1}_PRIVATE_KEY`);
  if (!wallet) return res.status(500).json({ error: `CONTACT${index + 1}_PRIVATE_KEY missing in the keeper's .env` });
  try {
    const onChain: string = await readVault.trustedContacts(index);
    // Safety: the key we'd sign with must belong to exactly this on-chain contact
    if (onChain.toLowerCase() !== wallet.address.toLowerCase()) {
      return res.status(409).json({ error: `Key for contact ${index + 1} (${wallet.address}) is not on-chain contact ${index + 1} (${onChain})` });
    }
  } catch (e: any) {
    return res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
  return sendAs(res, `confirmDeath (contact ${index + 1})`, wallet, (v, o) => v.confirmDeath(o));
});

// Demo only: back to a fresh ACTIVE vault so the demo can be rerun (not in the original interface;
// the backend's /demo/reset can call it). RELEASED -> resetDemo(), GRACE/CONFIRMED -> cancel().
app.post("/demo/reset", async (_req, res) => {
  if (!CUSTODIAL) return custodialOff(res, "Demo reset");
  const owner = envWallet("OWNER_PRIVATE_KEY");
  if (!owner) return res.status(500).json({ error: "OWNER_PRIVATE_KEY missing in the keeper's .env" });
  try {
    const { s } = await onChainStatus();
    if (!s.demoMode) return res.status(409).json({ error: "Not a demo deployment" });
    const state = Number(s.state);
    if (state === 3) return sendAs(res, "resetDemo", owner, (v, o) => v.resetDemo(o));
    if (state === 1 || state === 2) return sendAs(res, "cancel", owner, (v, o) => v.cancel(o));
    return sendAs(res, "checkIn", owner, (v, o) => v.checkIn(o)); // ACTIVE: just restart the clock
  } catch (e: any) {
    return res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
});

app.post("/demo/miss-deadline", async (_req, res) => {
  try {
    const { s, now } = await onChainStatus();
    const state = Number(s.state);
    if (state !== 0) return res.status(409).json({ error: `Vault is ${STATE_NAMES[state]}, not ACTIVE` });
    if (!s.demoMode) return res.status(409).json({ error: "Not a demo deployment: a real chain's clock can't be skipped" });
    const left = Math.max(0, Number(s.checkInDeadline) - now);
    // No transaction: block time can't be moved on a real chain. With demo timers the deadline
    // passes on its own and the keeper starts grace within one check interval.
    res.json({
      ok: true,
      tx_hash: null,
      seconds_until_grace: left + 6,
      message: left > 0 ? `No check-in: the deadline passes in ${left}s and the keeper starts grace automatically.` : "Deadline already passed: the keeper is starting grace now.",
    });
  } catch (e: any) {
    res.status(502).json({ error: `chain read failed: ${e?.shortMessage || e?.message}` });
  }
});

export function startAdapter() {
  app.listen(ADAPTER_PORT, ADAPTER_HOST, () => {
    const allow = ALLOWED_IPS.length ? `localhost + ${ALLOWED_IPS.join(", ")}` : "localhost only";
    console.log(`[adapter] Amanat backend interface on http://${ADAPTER_HOST}:${ADAPTER_PORT} (${allow})`);
    console.log(`[adapter] custodial signing for /checkin and /confirm: ${CUSTODIAL ? "ON (demo: keeper signs with owner/contact keys from .env)" : "off"}`);
    if (ADAPTER_HOST !== "127.0.0.1" && !ALLOWED_IPS.length) {
      console.log("[adapter] WARNING: listening on the network but ADAPTER_ALLOWED_IPS is empty, so only localhost is accepted");
    }
  });
}
