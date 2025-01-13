import { HardhatUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-ethers";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import * as tenderly from "@tenderly/hardhat-tenderly";
tenderly.setup({
  automaticVerifications: false,
});

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.0",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  }, // Adjust to your Solidity version
  tenderly: {
    username: "0xus",
    project: "project",
    // Contract visible only in Tenderly.
    // Omitting or setting to `false` makes it visible to the whole world.
    // Alternatively, configure verification visibility using
    // an environment variable `TENDERLY_PUBLIC_VERIFICATION`.
    privateVerification: process.env.TENDERLY_PUBLIC_VERIFICATION !== 'true',
  },
  networks: {
    hardhat: { 
      chainId: 31337,
    }, // Local Hardhat Network
    localhost: {
      // url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
    },
    // virtual_mainnet: {
    //   url: "https://virtual.mainnet.rpc.tenderly.co/852b73b2-9b8b-4195-bd6c-7ab587f5ae58",
    //   chainId: 1,
    //   currency: "VETH"
    // },
    virtualtestnet: {
      // https://docs.tenderly.co/account/projects/account-project-slug
      url: "https://virtual.mainnet.rpc.tenderly.co/852b73b2-9b8b-4195-bd6c-7ab587f5ae58",
      chainId: 1,
      // project: "project",
      // username: "0xus",
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
    },
    gnosis: {
      url: `https://rpc.gnosis.gateway.fm`,
      chainId: 100,
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
    }
  },
};

export default config;
