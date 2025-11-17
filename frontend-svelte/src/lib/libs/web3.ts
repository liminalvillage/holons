import Web3 from "web3";
import Fortmatic from "fortmatic";

let web3: Web3 | null = null;
let accountsCache: string[] = [];

export async function initWeb3(): Promise<Web3> {
  if (web3) {
    return web3;
  }

  if (typeof window === 'undefined') {
    throw new Error('Web3 can only be initialized in the browser');
  }

  // Check for modern Ethereum provider (MetaMask, etc.)
  if ((window as any).ethereum) {
    web3 = new Web3((window as any).ethereum);
    try {
      // Request account access
      await (window as any).ethereum.request({ method: 'eth_requestAccounts' });

      // Check network ID (3 = Ropsten)
      const chainId = await web3.eth.getChainId();
      if (chainId !== BigInt(3)) {
        alert("Please connect to Ropsten testnet to see the app");
      }
    } catch (error) {
      console.error("User denied account access", error);
    }
  }
  // Legacy dapp browsers
  else if ((window as any).web3) {
    web3 = new Web3((window as any).web3.currentProvider);
  }
  // Fallback to Fortmatic
  else {
    const fm = new Fortmatic('pk_test_20EFFE2EB24A0657', 'ropsten');
    web3 = new Web3(fm.getProvider() as any);
  }

  // Enable the provider if needed
  if (web3.currentProvider && typeof (web3.currentProvider as any).enable === 'function') {
    await (web3.currentProvider as any).enable();
  }

  return web3;
}

export async function getWeb3(): Promise<Web3> {
  if (!web3) {
    return await initWeb3();
  }
  return web3;
}

export async function getAccounts(): Promise<string[]> {
  const web3Instance = await getWeb3();
  const accounts = await web3Instance.eth.getAccounts();
  accountsCache = accounts;
  return accounts;
}

export function getCachedAccounts(): string[] {
  return accountsCache;
}

export default { initWeb3, getWeb3, getAccounts, getCachedAccounts };
