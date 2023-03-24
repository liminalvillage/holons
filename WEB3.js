import Web3 from 'web3';

// Set up Ethereum blockchain connection
var web3 = new Web3('https://sepolia.infura.io/v3/966b62ed84c84715bc5970a1afecad29');
const contractAddress = '0xcontract_address_here';
const privateKey = '0xprivate_key_here';
const abi = [{"constant":false,"inputs":[{"name":"_message","type":"string"}],"name":"saveMessage","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"}];

export  async function init () {
  // const provider = new Web3(privateKey, 'https://rinkeby.infura.io/v3/74aa9a15e2524f6980edb8a377301f3c'); 
  // web3 = new Web3(provider);
  // const networkId = await web3.eth.net.getId();
  // const myContract = new web3.eth.Contract(
  //   MyContract.abi,
  //   MyContract.networks[networkId].address
  // );

  // console.log(await myContract.methods.data().call());
  // console.log(`Old data value: ${await myContract.methods.data().call()}`);
  // const receipt = await myContract.methods.setData(3).send({ from: address });
  // console.log(`Transaction hash: ${receipt.transactionHash}`);
  // console.log(`New data value: ${await myContract.methods.data().call()}`);
}

init();

// save appreciation table to blockchain

// save appreciation table to blockchain
export async function saveToBlockchain(appreciationtable, chatID) {
  holons
}
  
