import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load variables from .env (keys never leave this file / process)
dotenv.config();

// Only add the deployer key if it exists, so compile/test work without a .env
const ownerKey = process.env.OWNER_PRIVATE_KEY;
const accounts = ownerKey ? [ownerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // "paris" avoids the PUSH0 opcode, which some EVM chains don't support yet
      evmVersion: "paris",
    },
  },
  networks: {
    // MST Testnet (chain ID 91562037 / 0x5752035)
    mst: {
      url: process.env.RPC_URL || "https://testnetrpc.mstblockchain.com",
      chainId: Number(process.env.CHAIN_ID || 91562037),
      accounts,
    },
  },
};

export default config;
