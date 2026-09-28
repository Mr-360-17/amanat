// LOCAL NODE ONLY. Prepares `npx hardhat node` for the demo:
//  - mines a block every second so block.timestamp keeps moving
//    (by default the local node only mines when a tx arrives)
//  - gives our generated wallets 100 test ETH each (free, local only)
// Run: npx tsx scripts/local-setup.ts   (with NETWORK=local in .env)
import { ethers } from "ethers";
import { IS_LOCAL, provider, walletFromEnv } from "./common";

async function main() {
  if (!IS_LOCAL) {
    console.error("local-setup only works with NETWORK=local in .env");
    process.exit(1);
  }

  await provider.send("evm_setIntervalMining", [1000]);
  console.log("Interval mining: 1 block per second");

  const wallets = [
    ["Owner", "OWNER_PRIVATE_KEY"],
    ["Keeper (agent)", "KEEPER_PRIVATE_KEY"],
    ["Trusted contact 1", "CONTACT1_PRIVATE_KEY"],
    ["Trusted contact 2", "CONTACT2_PRIVATE_KEY"],
    ["Trusted contact 3", "CONTACT3_PRIVATE_KEY"],
  ];
  const amount = ethers.toQuantity(ethers.parseEther("100"));

  console.log("\n=== Local balances ===");
  for (const [label, key] of wallets) {
    const address = walletFromEnv(key).address;
    await provider.send("hardhat_setBalance", [address, amount]);
    const bal = await provider.getBalance(address);
    console.log(`${label.padEnd(18)} ${address}  ${ethers.formatEther(bal)} ETH (local)`);
  }
}

main().catch((e) => {
  console.error("local-setup failed (is `npx hardhat node` running?):", e.shortMessage || e.message);
  process.exit(1);
});
