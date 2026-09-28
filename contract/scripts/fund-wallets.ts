// Sends small tMSTC amounts from the owner wallet to the keeper and 3 contacts.
// Tops each wallet up to a target balance (so re-running doesn't double-send).
// Run: npx tsx scripts/fund-wallets.ts [keeperTarget] [contactTarget]
//   e.g. npx tsx scripts/fund-wallets.ts 0.5 0.05
import { ethers } from "ethers";
import { provider, walletFromEnv, txOverrides, waitAndPrint } from "./common";

const keeperTarget = ethers.parseEther(process.argv[2] || "0.5");
const contactTarget = ethers.parseEther(process.argv[3] || "0.05");

const fmt = (wei: bigint) => `${Number(ethers.formatEther(wei)).toFixed(6)} tMSTC`;

async function printBalances(rows: { label: string; address: string }[]) {
  console.log("\n=== Balances ===");
  for (const r of rows) {
    const bal = await provider.getBalance(r.address);
    console.log(`${r.label.padEnd(18)} ${r.address}  ${fmt(bal)}`);
  }
}

async function main() {
  const owner = walletFromEnv("OWNER_PRIVATE_KEY");
  const targets = [
    { label: "Keeper (agent)", address: walletFromEnv("KEEPER_PRIVATE_KEY").address, target: keeperTarget },
    { label: "Trusted contact 1", address: walletFromEnv("CONTACT1_PRIVATE_KEY").address, target: contactTarget },
    { label: "Trusted contact 2", address: walletFromEnv("CONTACT2_PRIVATE_KEY").address, target: contactTarget },
    { label: "Trusted contact 3", address: walletFromEnv("CONTACT3_PRIVATE_KEY").address, target: contactTarget },
  ];

  // Work out how much each wallet still needs
  const needs: { label: string; address: string; amount: bigint }[] = [];
  for (const t of targets) {
    const bal = await provider.getBalance(t.address);
    if (bal < t.target) needs.push({ label: t.label, address: t.address, amount: t.target - bal });
  }

  const total = needs.reduce((sum, n) => sum + n.amount, 0n);
  const ownerBal = await provider.getBalance(owner.address);
  console.log(`Owner ${owner.address} has ${fmt(ownerBal)}; needs to send ${fmt(total)} in total.`);

  if (needs.length === 0) {
    console.log("All wallets already at target. Nothing to send.");
  } else {
    // Keep a small reserve for gas on the owner side
    const reserve = ethers.parseEther("0.01");
    if (ownerBal < total + reserve) {
      console.error(
        `\nNot enough tMSTC in the owner wallet. Fund ${owner.address} at the faucet, ` +
          `or pass smaller targets, e.g. npx tsx scripts/fund-wallets.ts 0.2 0.02`
      );
      process.exit(1);
    }

    const overrides = await txOverrides();
    for (const n of needs) {
      // Sequential sends: wait for each receipt so nonces never clash
      const tx = await owner.sendTransaction({ to: n.address, value: n.amount, ...overrides });
      await waitAndPrint(`Fund ${n.label} with ${fmt(n.amount)}`, tx);
    }
  }

  await printBalances([{ label: "Owner", address: owner.address }, ...targets]);
}

main().catch((e) => {
  console.error("fund-wallets failed:", e.shortMessage || e.message);
  process.exit(1);
});
