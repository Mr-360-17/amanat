// Autonomous keeper: watches the vault and pushes it forward when the rules allow.
// - Reads getStatus() + the latest block every CHECK_INTERVAL_SECONDS
// - Uses BLOCK time (not the laptop clock) for all deadline checks
// - Sends startGrace() / release() itself; never two keeper txs at once
// - Never crashes: RPC errors are retried with backoff
import { ethers } from "ethers";
import {
  NETWORK,
  CHAIN_ID,
  CONTRACT_ADDRESS,
  ABI,
  CHECK_INTERVAL_SECONDS,
  provider,
  keeperWallet,
  txUrl,
  txOverrides,
  decodeRevert,
} from "./config";
import { VaultState, STATE_NAMES, describe } from "./stateMachine";
import { notify, writeHeartbeat } from "./notifier";

const vault = new ethers.Contract(CONTRACT_ADDRESS, ABI, keeperWallet);

// ---------------------------------------------------------------------------
// Keeper transactions (one at a time)
// ---------------------------------------------------------------------------

export interface TxResult {
  action: string;
  hash: string;
  block: number;
  gasUsed: string;
  status: "SUCCESS" | "FAILED";
  explorerUrl: string;
}

/** Thrown when the contract refuses the call, e.g. someone else already advanced the state. */
export class ContractRefused extends Error {
  constructor(public errorName: string | null, message: string) {
    super(message);
  }
}

const TX_WAIT_TIMEOUT_MS = 120_000;
let txBusy = false;
let stuckTxHash: string | null = null; // a tx that timed out while waiting; must be mined before the next one

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function keeperTxBusy() {
  return txBusy || stuckTxHash !== null;
}

/**
 * Send one keeper transaction and wait for its receipt.
 * Waits up to `waitForLockMs` if another keeper tx is in flight (the API uses this; the loop passes 0).
 */
export async function sendKeeperTx(
  action: string,
  build: (overrides: { type: number; gasPrice: bigint }) => Promise<ethers.TransactionResponse>,
  waitForLockMs = 0
): Promise<TxResult> {
  const until = Date.now() + waitForLockMs;
  while (keeperTxBusy()) {
    await checkStuckTx();
    if (!keeperTxBusy()) break;
    if (Date.now() >= until) throw new Error("KEEPER_BUSY");
    await sleep(500);
  }

  txBusy = true;
  try {
    let tx: ethers.TransactionResponse;
    try {
      tx = await build(await txOverrides());
    } catch (e) {
      const decoded = decodeRevert(e, vault.interface);
      if (decoded.name) throw new ContractRefused(decoded.name, decoded.text);
      throw e;
    }

    console.log(`[AUTONOMOUS AGENT] ${action} submitted: ${tx.hash} (waiting for block...)`);
    let receipt: ethers.TransactionReceipt | null;
    try {
      receipt = await tx.wait(1, TX_WAIT_TIMEOUT_MS);
    } catch (e: any) {
      if (e?.code === "TIMEOUT") {
        stuckTxHash = tx.hash; // block further keeper txs until this one is mined
        throw new Error(`${action} not mined after ${TX_WAIT_TIMEOUT_MS / 1000}s (${tx.hash})`);
      }
      // Mined but reverted (status 0)
      receipt = e?.receipt ?? null;
      if (!receipt) throw e;
    }
    if (!receipt) throw new Error("No receipt");

    const result: TxResult = {
      action,
      hash: tx.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? "SUCCESS" : "FAILED",
      explorerUrl: txUrl(tx.hash),
    };
    printAgentBlock(result);
    return result;
  } finally {
    txBusy = false;
  }
}

/** Used by POST /vault/hash: the keeper stores a vault hash on-chain. */
export function storeVaultHash(hash: string, waitForLockMs: number) {
  return sendKeeperTx("storeVaultHash", (o) => vault.storeVaultHash(hash, o), waitForLockMs);
}

async function checkStuckTx() {
  if (!stuckTxHash) return;
  try {
    const receipt = await provider.getTransactionReceipt(stuckTxHash);
    if (receipt) {
      console.log(`[AUTONOMOUS AGENT] earlier tx ${stuckTxHash} was mined in block ${receipt.blockNumber}`);
      stuckTxHash = null;
    }
  } catch {
    /* RPC hiccup - try again next tick */
  }
}

function printAgentBlock(r: TxResult) {
  console.log("\n==================== [AUTONOMOUS AGENT] ====================");
  console.log(`  Action:   ${r.action}`);
  console.log(`  Tx hash:  ${r.hash}`);
  console.log(`  Block:    ${r.block}`);
  console.log(`  Gas used: ${r.gasUsed}`);
  console.log(`  Status:   ${r.status}`);
  console.log(`  Explorer: ${r.explorerUrl}`);
  console.log("============================================================\n");
}

/**
 * Run a keeper action from the loop without blocking it.
 * A contract refusal (state already advanced by someone else) is logged calmly and not retried.
 */
function runAction(key: string, action: string, build: Parameters<typeof sendKeeperTx>[1], onSuccess: (r: TxResult) => void) {
  if (keeperTxBusy() || done.has(key)) return;
  sendKeeperTx(action, build)
    .then((r) => {
      done.add(key);
      if (r.status === "SUCCESS") onSuccess(r);
      else console.log(`[AUTONOMOUS AGENT] ${action} was mined but FAILED (state probably changed). Continuing.`);
    })
    .catch((e) => {
      if (e instanceof ContractRefused) {
        done.add(key); // don't retry: the contract says this action isn't valid (anymore)
        console.log(`[AUTONOMOUS AGENT] ${action} not needed: ${e.message} - someone else probably advanced the state. Continuing.`);
      } else {
        console.log(`[AUTONOMOUS AGENT] ${action} failed: ${e.shortMessage || e.message}. Will retry next check.`);
      }
    });
}

// ---------------------------------------------------------------------------
// Monitoring loop
// ---------------------------------------------------------------------------

const done = new Set<string>(); // "once" keys for notifications and actions
function once(key: string, fn: () => void) {
  if (done.has(key)) return;
  done.add(key);
  fn();
}

let last: { state: number; round: number } | null = null;
let failures = 0;
let lastCheckMs = 0;
let lastError: string | null = null;
let lastSummary: Record<string, unknown> = {};
let keeperBalance = "?";
let balanceCheckedMs = 0;

async function tick() {
  // One status read + the latest block (for chain time)
  const [raw, block] = await Promise.all([vault.getStatus(), provider.getBlock("latest")]);
  if (!block) throw new Error("No latest block");
  const now = block.timestamp;

  const s = {
    state: Number(raw.state),
    round: Number(raw.round),
    checkInPeriod: Number(raw.checkInPeriod),
    checkInDeadline: Number(raw.checkInDeadline),
    graceDeadline: Number(raw.graceDeadline),
    releaseAvailableAt: Number(raw.releaseAvailableAt),
    confirmationCount: Number(raw.confirmationCount),
  };
  const d = describe(s, now);
  const r = s.round;

  // --- react to state changes made by others (owner, contacts) ---
  if (last && last.state !== s.state) {
    console.log(`[keeper] state ${STATE_NAMES[last.state]} -> ${STATE_NAMES[s.state]}`);
    if (s.state === VaultState.ACTIVE && (last.state === VaultState.GRACE || last.state === VaultState.CONFIRMED)) {
      notify({ type: "active", title: "🛡️ OWNER IS ALIVE - RELEASE CANCELLED", message: "Vault is back to ACTIVE. Old confirmations were cleared." });
    }
    if (s.state === VaultState.ACTIVE && last.state === VaultState.RELEASED) {
      notify({ type: "active", title: "🔄 DEMO RESET", message: "Vault reset to ACTIVE with a fresh check-in deadline." });
    }
  }

  // --- ACTIVE ---
  if (s.state === VaultState.ACTIVE) {
    const left = s.checkInDeadline - now;
    // Reminder once per deadline when 50% or less of the period is left
    if (left >= 0 && left <= s.checkInPeriod / 2) {
      once(`remind:${r}:${s.checkInDeadline}`, () =>
        notify({ type: "reminder", title: "⚠️ LEGACYVAULT REMINDER", message: `Owner check-in due in ${left}s.` })
      );
    }
    if (now > s.checkInDeadline) {
      once(`missed:${r}:${s.checkInDeadline}`, () =>
        notify({ type: "missed", title: "🚨 CHECK-IN MISSED", message: `Deadline passed ${now - s.checkInDeadline}s ago. Starting grace period.` })
      );
      runAction(`tx:grace:${r}:${s.checkInDeadline}`, "startGrace", (o) => vault.startGrace(o), (res) =>
        notify({ type: "grace", title: "⏳ GRACE PERIOD STARTED", message: "Keeper started the grace period. The owner can still check in.", txHash: res.hash, explorerUrl: res.explorerUrl })
      );
    }
  }

  // --- GRACE ---
  if (s.state === VaultState.GRACE && now > s.graceDeadline) {
    once(`confirmreq:${r}`, () =>
      notify({ type: "grace", title: "🔐 TRUSTED CONTACT CONFIRMATION REQUIRED", message: "Grace period is over. 2 of 3 trusted contacts must confirm." })
    );
  }

  // --- confirmations (GRACE or CONFIRMED) ---
  if (s.state === VaultState.GRACE || s.state === VaultState.CONFIRMED) {
    // Loop from 1 so a jump (0 -> 2 between two checks) still announces "1 OF 2" first
    for (let n = 1; n <= s.confirmationCount; n++) {
      once(`conf:${r}:${n}`, () =>
        notify({ type: "confirmation", title: `✅ ${n} OF 2 REQUIRED CONFIRMATIONS`, message: n >= 2 ? "Death confirmed. Release after the safety delay." : "Waiting for one more trusted contact." })
      );
    }
  }

  // --- CONFIRMED ---
  if (s.state === VaultState.CONFIRMED) {
    once(`confirmed:${r}`, () =>
      notify({ type: "confirmed", title: "⏳ RELEASE SCHEDULED", message: `Release available in ${Math.max(0, s.releaseAvailableAt - now)}s. The owner can still cancel.` })
    );
    if (now >= s.releaseAvailableAt) {
      runAction(`tx:release:${r}`, "release", (o) => vault.release(o), (res) =>
        once(`released:${r}`, () =>
          notify({ type: "released", title: "🚀 VAULT RELEASED", message: "Keeper released the vault to the beneficiaries.", txHash: res.hash, explorerUrl: res.explorerUrl })
        )
      );
    }
  }

  // --- RELEASED (by us or anyone else) ---
  if (s.state === VaultState.RELEASED) {
    once(`released:${r}`, () => notify({ type: "released", title: "🚀 VAULT RELEASED", message: "The vault has been released." }));
  }

  // Keeper gas balance, at most once a minute
  if (Date.now() - balanceCheckedMs > 60_000) {
    keeperBalance = ethers.formatEther(await provider.getBalance(keeperWallet.address));
    balanceCheckedMs = Date.now();
  }

  last = { state: s.state, round: r };
  lastSummary = {
    state: STATE_NAMES[s.state],
    round: r,
    headline: d.headline,
    nextAction: d.nextAction,
    block: block.number,
    chainTime: now,
    confirmations: s.confirmationCount,
  };
  console.log(`[keeper] block ${block.number} | ${STATE_NAMES[s.state]} | ${d.headline}${keeperTxBusy() ? " | tx pending" : ""}`);
}

function saveHeartbeat(nextCheckMs: number) {
  writeHeartbeat({
    lastCheck: lastCheckMs ? new Date(lastCheckMs).toISOString() : null,
    lastCheckMs,
    nextCheck: new Date(nextCheckMs).toISOString(),
    nextCheckMs,
    intervalSeconds: CHECK_INTERVAL_SECONDS,
    network: NETWORK,
    chainId: CHAIN_ID,
    contract: CONTRACT_ADDRESS,
    keeper: keeperWallet.address,
    keeperBalance,
    txPending: keeperTxBusy(),
    consecutiveFailures: failures,
    lastError,
    ...lastSummary,
  });
}

async function loop() {
  let delaySeconds = CHECK_INTERVAL_SECONDS;
  try {
    await checkStuckTx();
    await tick();
    lastCheckMs = Date.now();
    failures = 0;
    lastError = null;
  } catch (e: any) {
    // Never crash: back off (5s, 10s, 20s, ... max 60s) and try again
    failures += 1;
    lastError = e?.shortMessage || e?.message || String(e);
    delaySeconds = Math.min(CHECK_INTERVAL_SECONDS * 2 ** failures, 60);
    console.log(`[keeper] check failed (${failures}x): ${lastError}. Retrying in ${delaySeconds}s`);
  }
  const nextCheckMs = Date.now() + delaySeconds * 1000;
  try {
    saveHeartbeat(nextCheckMs);
  } catch (e: any) {
    console.log(`[keeper] could not write heartbeat: ${e.message}`);
  }
  setTimeout(loop, delaySeconds * 1000);
}

export async function startKeeper() {
  console.log("============================================================");
  console.log("  LEGACYVAULT AUTONOMOUS KEEPER");
  console.log(`  Network:  ${NETWORK} (chainId ${CHAIN_ID})`);
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  Keeper:   ${keeperWallet.address}`);
  console.log(`  Interval: every ${CHECK_INTERVAL_SECONDS}s (deadlines use block time)`);
  console.log("============================================================");
  loop();
}
