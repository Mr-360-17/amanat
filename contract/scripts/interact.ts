// Manual CLI for the deployed vault.
// Usage: npx tsx scripts/interact.ts <command>
//   status             show full vault status (read-only)
//   checkin            owner: "I'm still here"
//   confirm <1|2|3>    trusted contact N confirms death
//   cancel             owner: cancel a pending release (GRACE/CONFIRMED)
//   reset              owner: resetDemo (RELEASED -> ACTIVE, demo mode only)
//   hash <0x..64hex>   owner: store a vault hash
//   grace              keeper: startGrace (normally the agent does this)
//   release            keeper: release (normally the agent does this)
import { ethers } from "ethers";
import {
  NETWORK,
  provider,
  walletFromEnv,
  getVault,
  txOverrides,
  waitAndPrint,
  STATE_NAMES,
  addressUrl,
  decodeRevert,
} from "./common";

const fmtTime = (ts: bigint, now: number) => {
  if (ts === 0n) return "-";
  const t = Number(ts);
  const diff = t - now;
  const rel = diff >= 0 ? `in ${diff}s` : `${-diff}s ago`;
  return `${new Date(t * 1000).toLocaleString()}  (${rel})`;
};

async function showStatus() {
  const vault = getVault();
  const s = await vault.getStatus();
  // Use chain time, not the laptop clock
  const now = (await provider.getBlock("latest"))!.timestamp;

  console.log(`\n=== LegacyVault status (${NETWORK}) ===`);
  console.log(`Contract:          ${await vault.getAddress()}`);
  console.log(`Explorer:          ${addressUrl(await vault.getAddress())}`);
  console.log(`State:             ${STATE_NAMES[Number(s.state)]}   (round ${s.round})`);
  console.log(`Owner:             ${s.owner}`);
  console.log(`Keeper:            ${s.keeper}`);
  console.log(`Chain time:        ${new Date(now * 1000).toLocaleString()}`);
  console.log(`Last check-in:     ${fmtTime(s.lastCheckIn, now)}`);
  console.log(`Check-in deadline: ${fmtTime(s.checkInDeadline, now)}`);
  console.log(`Grace deadline:    ${fmtTime(s.graceDeadline, now)}`);
  console.log(`Release available: ${fmtTime(s.releaseAvailableAt, now)}`);
  console.log(`Confirmations:     ${s.confirmationCount} / 2`);
  s.trustedContacts.forEach((c: string, i: number) => console.log(`Contact ${i + 1}:         ${c}`));
  console.log(`Beneficiaries:     ${s.beneficiaries.join(", ")}`);
  console.log(`Vault hash:        ${s.vaultHash}`);
  console.log(
    `Periods:           check-in ${s.checkInPeriod}s, grace ${s.gracePeriod}s, release delay ${s.releaseDelay}s` +
      (s.demoMode ? "  (DEMO MODE)" : "")
  );
}

async function send(label: string, walletKey: string, fn: (v: ethers.Contract) => Promise<ethers.TransactionResponse>) {
  const wallet = walletFromEnv(walletKey);
  const vault = getVault(wallet);
  console.log(`${label} from ${wallet.address}`);
  await waitAndPrint(label, await fn(vault));
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  switch (cmd) {
    case "status":
      return showStatus();

    case "checkin":
      await send("checkIn", "OWNER_PRIVATE_KEY", async (v) => v.checkIn(await txOverrides()));
      return showStatus();

    case "confirm": {
      if (!["1", "2", "3"].includes(arg)) throw new Error("Usage: confirm <1|2|3>");
      await send(`confirmDeath (contact ${arg})`, `CONTACT${arg}_PRIVATE_KEY`, async (v) =>
        v.confirmDeath(await txOverrides())
      );
      return showStatus();
    }

    case "cancel":
      await send("cancel", "OWNER_PRIVATE_KEY", async (v) => v.cancel(await txOverrides()));
      return showStatus();

    case "reset":
      await send("resetDemo", "OWNER_PRIVATE_KEY", async (v) => v.resetDemo(await txOverrides()));
      return showStatus();

    case "hash": {
      if (!/^0x[0-9a-fA-F]{64}$/.test(arg || "")) throw new Error("Usage: hash <0x + 64 hex chars>");
      await send("storeVaultHash", "OWNER_PRIVATE_KEY", async (v) => v.storeVaultHash(arg, await txOverrides()));
      return showStatus();
    }

    case "grace":
      await send("startGrace", "KEEPER_PRIVATE_KEY", async (v) => v.startGrace(await txOverrides()));
      return showStatus();

    case "release":
      await send("release", "KEEPER_PRIVATE_KEY", async (v) => v.release(await txOverrides()));
      return showStatus();

    default:
      console.log("Commands: status | checkin | confirm <1|2|3> | cancel | reset | hash <hex> | grace | release");
  }
}

main().catch((e) => {
  console.error("Failed:", decodeRevert(e, getVault().interface).text);
  process.exit(1);
});
