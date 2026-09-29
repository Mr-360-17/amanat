// End-to-end demo scenarios with REAL transactions. The keeper agent must be running
// (npm run agent): this script plays the humans, the keeper does the automatic steps.
//
//   npx tsx scripts/scenario.ts release    miss -> keeper starts grace -> 2 contacts confirm -> keeper releases
//   npx tsx scripts/scenario.ts recovery   miss -> keeper starts grace -> owner checks in -> ACTIVE
//
// Each run starts by putting the vault back into a fresh ACTIVE state, so it can be repeated.
import { ethers } from "ethers";
import {
  NETWORK,
  provider,
  walletFromEnv,
  getVault,
  txOverrides,
  waitAndPrint,
  STATE_NAMES,
  txUrl,
} from "./common";

const API_URL = `http://localhost:${process.env.API_PORT || 4000}`;
const ACTIVE = 0, GRACE = 1, CONFIRMED = 2, RELEASED = 3;

const owner = walletFromEnv("OWNER_PRIVATE_KEY");
const contact1 = walletFromEnv("CONTACT1_PRIVATE_KEY");
const contact2 = walletFromEnv("CONTACT2_PRIVATE_KEY");
const keeperAddress = walletFromEnv("KEEPER_PRIVATE_KEY").address;
const readVault = getVault();

interface Step { step: string; actor: string; hash: string; block: number }
const steps: Step[] = [];
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function snapshot() {
  const [s, block] = await Promise.all([readVault.getStatus(), provider.getBlock("latest")]);
  return { s, now: block!.timestamp, block: block!.number };
}

/** A human action (owner / contact) sent from their own wallet. */
async function human(label: string, actor: string, wallet: ethers.Wallet, fn: (v: ethers.Contract, o: object) => Promise<ethers.TransactionResponse>) {
  const receipt = await waitAndPrint(`${label}  [${actor}]`, await fn(getVault(wallet), await txOverrides()));
  steps.push({ step: label, actor, hash: receipt.hash, block: receipt.blockNumber });
}

/** Poll (every 2s, chain time) until `done` is true, or fail after `timeoutSec`. */
async function waitFor(what: string, timeoutSec: number, done: (s: any, now: number) => boolean) {
  console.log(`\n... waiting: ${what}`);
  const deadline = Date.now() + timeoutSec * 1000;
  let lastPrint = 0;
  while (Date.now() < deadline) {
    const { s, now } = await snapshot();
    if (done(s, now)) return;
    if (Date.now() - lastPrint > 5000) {
      console.log(`    [${elapsed()}] state ${STATE_NAMES[Number(s.state)]}, confirmations ${s.confirmationCount}/2`);
      lastPrint = Date.now();
    }
    await sleep(2000);
  }
  throw new Error(`Timed out after ${timeoutSec}s waiting for: ${what}`);
}

/** Find the keeper's tx for an event (GraceStarted / VaultReleased) and check the keeper sent it. */
async function keeperStep(label: string, eventName: string, fromBlock: number) {
  const logs = await readVault.queryFilter(eventName, fromBlock, "latest");
  const log = logs[logs.length - 1] as ethers.EventLog | undefined;
  if (!log) throw new Error(`No ${eventName} event found`);
  const caller: string = log.args[0];
  if (caller.toLowerCase() !== keeperAddress.toLowerCase()) {
    throw new Error(`${eventName} was sent by ${caller}, not by the keeper ${keeperAddress}`);
  }
  console.log(`\n[AUTONOMOUS AGENT] ${label}: ${log.transactionHash} (block ${log.blockNumber})`);
  steps.push({ step: label, actor: "KEEPER (auto)", hash: log.transactionHash, block: log.blockNumber });
}

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`    ✓ ${msg}`);
}

/** Put the vault into a fresh ACTIVE state so every run starts the same way. */
async function freshStart() {
  const { s } = await snapshot();
  const state = Number(s.state);
  console.log(`Current state: ${STATE_NAMES[state]} (round ${s.round})`);
  if (state === RELEASED) await human("Reset demo", "OWNER", owner, (v, o) => v.resetDemo(o));
  else if (state === GRACE || state === CONFIRMED) await human("Cancel pending release", "OWNER", owner, (v, o) => v.cancel(o));
  else await human("Check-in (start clean)", "OWNER", owner, (v, o) => v.checkIn(o));
  // Trusted Circle: contacts 1 and 2 must have accepted the role before they can confirm
  const accepted: boolean[] = [...(await snapshot()).s.contactAccepted];
  if (!accepted[0]) await human("Accept role (contact 1)", "CONTACT 1", contact1, (v, o) => v.acceptRole(o));
  if (!accepted[1]) await human("Accept role (contact 2)", "CONTACT 2", contact2, (v, o) => v.acceptRole(o));
  const after = await snapshot();
  check(Number(after.s.state) === ACTIVE, "vault is ACTIVE with a fresh check-in deadline");
  check(after.s.contactAccepted[0] && after.s.contactAccepted[1], "contacts 1 and 2 have accepted the role");
  return after;
}

async function missCheckInAndWaitForKeeper(checkInPeriod: number) {
  const { block } = await snapshot();
  console.log(`\n>>> Owner stops checking in. Deadline is ${checkInPeriod}s away.`);
  await waitFor("keeper starts the grace period", checkInPeriod + 60, (s) => Number(s.state) === GRACE);
  await keeperStep("startGrace", "GraceStarted", block);
}

async function releaseScenario() {
  const start = await freshStart();
  const round = Number(start.s.round);
  await missCheckInAndWaitForKeeper(Number(start.s.checkInPeriod));

  const g = await snapshot();
  await waitFor("grace period to end (owner gets the full window)", Number(g.s.gracePeriod) + 60, (s, now) => now > Number(s.graceDeadline));

  console.log("\n>>> Trusted contacts confirm.");
  await human("Confirm death (contact 1)", "CONTACT 1", contact1, (v, o) => v.confirmDeath(o));
  check(Number((await snapshot()).s.confirmationCount) === 1, "1 of 2 confirmations, still GRACE");
  await human("Confirm death (contact 2)", "CONTACT 2", contact2, (v, o) => v.confirmDeath(o));
  const c = await snapshot();
  check(Number(c.s.state) === CONFIRMED, "2 of 2 confirmations -> CONFIRMED");

  await waitFor("keeper releases after the safety delay", Number(c.s.releaseDelay) + 60, (s) => Number(s.state) === RELEASED);
  await keeperStep("release", "VaultReleased", c.block);
  const end = await snapshot();
  check(Number(end.s.state) === RELEASED && Number(end.s.round) === round, `vault RELEASED in round ${round}`);
}

async function recoveryScenario() {
  const start = await freshStart();
  const round = Number(start.s.round);
  await missCheckInAndWaitForKeeper(Number(start.s.checkInPeriod));

  const g = await snapshot();
  check(Number(g.now) <= Number(g.s.graceDeadline), `owner is still inside the grace window (${Number(g.s.graceDeadline) - g.now}s left)`);

  console.log("\n>>> Owner was only away - checks in during grace.");
  await human("Check-in during grace", "OWNER", owner, (v, o) => v.checkIn(o));
  const a = await snapshot();
  check(Number(a.s.state) === ACTIVE, "vault back to ACTIVE");
  check(Number(a.s.round) === round + 1, `new round ${round + 1} (old confirmations can't carry over)`);
  check(Number(a.s.confirmationCount) === 0, "confirmations cleared");
  check(Number(a.s.checkInDeadline) > a.now, `fresh deadline in ${Number(a.s.checkInDeadline) - a.now}s`);

  // The keeper must NOT start grace again right away
  await sleep(8000);
  check(Number((await snapshot()).s.state) === ACTIVE, "8s later: still ACTIVE (keeper did not re-trigger)");
}

async function main() {
  const which = process.argv[2];
  if (which !== "release" && which !== "recovery") {
    console.log("Usage: npx tsx scripts/scenario.ts <release|recovery>");
    process.exit(1);
  }

  // The keeper does half the work, so it must be running
  try {
    const agent = await (await fetch(`${API_URL}/agent/status`)).json();
    if (agent.status !== "ONLINE") throw new Error(`agent status ${agent.status}`);
    console.log(`Keeper agent ONLINE (${agent.keeper})`);
  } catch (e: any) {
    console.error(`Keeper agent not reachable/online at ${API_URL} (${e.message}). Start it with: npm run agent`);
    process.exit(1);
  }

  console.log(`\n=========== SCENARIO: ${which.toUpperCase()} (${NETWORK}) ===========`);
  if (which === "release") await releaseScenario();
  else await recoveryScenario();

  console.log(`\n=========== ${which.toUpperCase()} SCENARIO PASSED in ${elapsed()} ===========`);
  for (const st of steps) {
    console.log(`  ${st.step.padEnd(28)} ${st.actor.padEnd(14)} block ${String(st.block).padEnd(7)} ${st.hash}`);
    if (!txUrl(st.hash).startsWith("(")) console.log(`  ${"".padEnd(28)} ${txUrl(st.hash)}`);
  }
}

main().catch((e) => {
  console.error(`\nSCENARIO FAILED after ${elapsed()}: ${e.shortMessage || e.message}`);
  process.exit(1);
});
