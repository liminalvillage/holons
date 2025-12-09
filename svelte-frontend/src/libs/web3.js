// Web3 integration module for Svelte
let web3Instance = null;

export async function initWeb3() {
  if (web3Instance) return web3Instance;

  try {
    const Web3Module = await import('web3');
    const Web3 = Web3Module.default || Web3Module;

    // Check for modern ethereum provider
    if (typeof window !== 'undefined' && window.ethereum) {
      web3Instance = new Web3(window.ethereum);
      try {
        // Request account access
        await window.ethereum.request({ method: 'eth_requestAccounts' });
      } catch (error) {
        console.error('User denied account access');
      }
    }
    // Legacy web3 provider
    else if (typeof window !== 'undefined' && window.web3) {
      web3Instance = new Web3(window.web3.currentProvider);
    }
    // Fallback to Fortmatic or default provider
    else {
      try {
        const FortmaticModule = await import('fortmatic');
        const Fortmatic = FortmaticModule.default || FortmaticModule;
        const fm = new Fortmatic('pk_live_E25B84AEC1D9F0D6');
        web3Instance = new Web3(fm.getProvider());
      } catch (e) {
        // No provider available, use HTTP provider
        console.warn('No web3 provider found, using Infura');
        web3Instance = new Web3(
          new Web3.providers.HttpProvider('https://ropsten.infura.io/v3/966b62ed84c84715bc5970a1afecad29')
        );
      }
    }

    // Check network
    if (web3Instance) {
      try {
        const networkType = await web3Instance.eth.net.getNetworkType();
        if (networkType !== 'ropsten') {
          console.warn('Please connect to Ropsten network');
        }
      } catch (e) {
        console.warn('Could not determine network type');
      }
    }
  } catch (e) {
    console.error('Web3 initialization error:', e);
  }

  return web3Instance;
}

export function getWeb3() {
  return web3Instance;
}

export async function getAccounts() {
  if (!web3Instance) {
    await initWeb3();
  }
  if (web3Instance) {
    return await web3Instance.eth.getAccounts();
  }
  return [];
}

export async function sendTransaction(from, to, value) {
  if (!web3Instance) {
    await initWeb3();
  }
  if (web3Instance) {
    return await web3Instance.eth.sendTransaction({
      from,
      to,
      value: web3Instance.utils.toWei(value.toString(), 'ether')
    });
  }
  throw new Error('Web3 not initialized');
}

export default {
  initWeb3,
  getWeb3,
  getAccounts,
  sendTransaction
};
