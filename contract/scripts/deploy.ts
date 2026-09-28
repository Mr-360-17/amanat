// Deploys LegacyVault, sets trusted contacts + beneficiaries, and writes
// deployment.json, abi/LegacyVault.json and CONTRACT_ADDRESS / DEPLOY_BLOCK in .env.
// Run: npx hardhat compile  then  npx tsx scripts/deploy.ts
import * as fs from "fs";
import { ethers } from "ethers";
import {
  NETWORK,
  CHAIN_ID,
  DEPLOYMENT_PATH,
  provider,
  walletFromEnv,
  requireEnv,
  loadArtifact,
  txOverrides,
  waitAndPrint,
  setEnvValue,
  addressUrl,
  txUrl,
} from "./common";
import { exportAbi } from "./export-abi";

const DAY = 24 * 60 * 60;

function getPeriods() {
  const demoMode = (process.env.DEMO_MODE || "true").trim().toLowerCase() === "true";
  if (demoMode) {
    return {
      demoMode,
      checkInPeriod: Number(process.env.DEMO_CHECKIN_SECONDS || 30),
      gracePeriod: Number(process.env.DEMO_GRACE_SECONDS || 30),
      releaseDelay: Number(process.env.DEMO_RELEASE_DELAY_SECONDS || 15),
    };
  }
  // Normal mode: 30 days check-in, 7 days grace, 2 days release delay
  return { demoMode, checkInPeriod: 30 * DAY, gracePeriod: 7 * DAY, releaseDelay: 2 * DAY };
}

async function main() {
  const owner = walletFromEnv("OWNER_PRIVATE_KEY");
  const keeper = walletFromEnv("KEEPER_PRIVATE_KEY");
  const contacts = [
    walletFromEnv("CONTACT1_PRIVATE_KEY").address,
    walletFromEnv("CONTACT2_PRIVATE_KEY").address,
    walletFromEnv("CONTACT3_PRIVATE_KEY").address,
  ];
  const beneficiaries = requireEnv("BENEFICIARY_ADDRESSES")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  for (const b of beneficiaries) {
    if (!ethers.isAddress(b)) throw new Error(`Invalid beneficiary address: ${b}`);
  }

  const p = getPeriods();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`RPC chainId ${network.chainId} does not match expected ${CHAIN_ID}`);
  }

  console.log(`Network:  ${NETWORK} (chainId ${CHAIN_ID})`);
  console.log(`Owner:    ${owner.address}  balance ${ethers.formatEther(await provider.getBalance(owner.address))}`);
  console.log(`Keeper:   ${keeper.address}`);
  console.log(
    `Periods:  check-in ${p.checkInPeriod}s, grace ${p.gracePeriod}s, release delay ${p.releaseDelay}s` +
      (p.demoMode ? "  (DEMO MODE)" : "")
  );

  // 1) Deploy
  const { abi, bytecode } = loadArtifact();
  const factory = new ethers.ContractFactory(abi, bytecode, owner);
  const overrides = await txOverrides();
  const contract = await factory.deploy(
    keeper.address,
    p.checkInPeriod,
    p.gracePeriod,
    p.releaseDelay,
    p.demoMode,
    overrides
  );
  const deployReceipt = await waitAndPrint("Deploy LegacyVault", contract.deploymentTransaction()!);
  const address = await contract.getAddress();
  const vault = new ethers.Contract(address, abi, owner);

  // 2) Configure trusted contacts + beneficiaries
  await waitAndPrint("setTrustedContacts", await vault.setTrustedContacts(contacts, await txOverrides()));
  await waitAndPrint("setBeneficiaries", await vault.setBeneficiaries(beneficiaries, await txOverrides()));

  // 3) Optional: store an initial vault hash from .env
  const vaultHash = (process.env.VAULT_HASH || "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(vaultHash)) {
    await waitAndPrint("storeVaultHash", await vault.storeVaultHash(vaultHash, await txOverrides()));
  }

  // 4) Save outputs for the keeper + frontend
  const deployment = {
    network: NETWORK,
    chainId: CHAIN_ID,
    address,
    deployBlock: deployReceipt.blockNumber,
    deployTxHash: deployReceipt.hash,
    deployedAt: new Date().toISOString(),
    owner: owner.address,
    keeper: keeper.address,
    trustedContacts: contacts,
    beneficiaries,
    params: p,
  };
  fs.writeFileSync(DEPLOYMENT_PATH, JSON.stringify(deployment, null, 2));
  exportAbi();
  setEnvValue("CONTRACT_ADDRESS", address, false);
  setEnvValue("DEPLOY_BLOCK", String(deployReceipt.blockNumber), false);

  console.log("\n==============================================");
  console.log("  CONTRACT DEPLOYED");
  console.log("==============================================");
  console.log(`  Network:      ${NETWORK} (chainId ${CHAIN_ID})`);
  console.log(`  Address:      ${address}`);
  console.log(`  Deploy block: ${deployReceipt.blockNumber}`);
  console.log(`  Deploy tx:    ${txUrl(deployReceipt.hash)}`);
  console.log(`  Contract:     ${addressUrl(address)}`);
  console.log("  Saved:        deployment.json, abi/LegacyVault.json, .env (CONTRACT_ADDRESS, DEPLOY_BLOCK)");
  console.log("==============================================");
}

main().catch((e) => {
  console.error("Deploy failed:", e.shortMessage || e.message);
  process.exit(1);
});
