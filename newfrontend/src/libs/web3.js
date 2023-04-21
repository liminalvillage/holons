import Web3 from 'web3'
import Fortmatic from 'fortmatic'
let web3

if (window.ethereum) {
  web3 = new Web3(window.ethereum)
  try {
    // Request account access if needed
    window.ethereum.enable()

    web3.eth.net.getNetworkType().then((name) => {
      if (name !== 'ropsten') {
        alert('please connect to Ropsten testnet to see the app ')
      }
    })
  } catch (error) {
    // User denied account access...
  }
} else if (window.web3) {
  // Legacy dapp browsers...
  web3 = new Web3(web3.currentProvider)
} else {
  let fm = new Fortmatic('pk_test_20EFFE2EB24A0657', 'ropsten')
  web3 = new Web3(fm.getProvider())
  // web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:7545"));
  // console.log(
  //   "Non-Ethereum browser detected. You should consider trying MetaMask!"
  // );
  // alert("Non-Ethereum browser detected. You should consider trying MetaMask!");
}
web3.currentProvider.enable()

export default web3
