import Web3 from 'web3';
import { ETH_DATA_FORMAT, DEFAULT_RETURN_FORMAT } from "web3";
import config from "./config.json" assert { type: "json" };
import * as appreciative from './contracts/Appreciative.json' assert { type: "json" };
import  * as factory from './contracts/IHolonFactory.json' assert { type: "json" };
const provider = new Web3.providers.HttpProvider(config.web3provider);
//const provider = config.web3provider;
//const contractAddress = '0x48252499296B216De59c4E0b6DdB4241e0740a13'; //old contract
//const contractAddress = '0x9065eF317cA9701BB0fdd90384D0994B897E96eF'; // HOLONS
const contractAddress = '0x8cFd463158cD16652302b21444E76BccFf3A788C' //Appreciative Factory
const privateKey = config.web3key;
const abi = [
	{
		"inputs": [],
		"name": "listHolons",
		"outputs": [
			{
				"internalType": "address[]",
				"name": "",
				"type": "address[]"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "_address",
				"type": "address"
			}
		],
		"name": "listHolonsOf",
		"outputs": [
			{
				"internalType": "address[]",
				"name": "",
				"type": "address[]"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "string",
				"name": "_name",
				"type": "string"
			},
			{
				"internalType": "uint256",
				"name": "_parameter",
				"type": "uint256"
			}
		],
		"name": "newHolon",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "nonpayable",
		"type": "function"
	}
]

//const abi = appreciative.abi;
// const abi = [
// 	{
// 		"inputs": [
// 			{
// 				"internalType": "string",
// 				"name": "_flavorname",
// 				"type": "string"
// 			},
// 			{
// 				"internalType": "address",
// 				"name": "_flavoraddress",
// 				"type": "address"
// 			}
// 		],
// 		"name": "newFlavor",
// 		"outputs": [],
// 		"stateMutability": "nonpayable",
// 		"type": "function"
// 	},
// 	{
// 		"anonymous": false,
// 		"inputs": [
// 			{
// 				"indexed": true,
// 				"internalType": "address",
// 				"name": "flavor",
// 				"type": "address"
// 			},
// 			{
// 				"indexed": false,
// 				"internalType": "string",
// 				"name": "name",
// 				"type": "string"
// 			}
// 		],
// 		"name": "NewFlavor",
// 		"type": "event"
// 	},
// 	{
// 		"inputs": [
// 			{
// 				"internalType": "string",
// 				"name": "_flavor",
// 				"type": "string"
// 			},
// 			{
// 				"internalType": "string",
// 				"name": "_name",
// 				"type": "string"
// 			},
// 			{
// 				"internalType": "uint256",
// 				"name": "_parameter",
// 				"type": "uint256"
// 			}
// 		],
// 		"name": "newHolon",
// 		"outputs": [
// 			{
// 				"internalType": "address",
// 				"name": "",
// 				"type": "address"
// 			}
// 		],
// 		"stateMutability": "nonpayable",
// 		"type": "function"
// 	},
// 	{
// 		"anonymous": false,
// 		"inputs": [
// 			{
// 				"indexed": false,
// 				"internalType": "string",
// 				"name": "name",
// 				"type": "string"
// 			},
// 			{
// 				"indexed": false,
// 				"internalType": "address",
// 				"name": "addr",
// 				"type": "address"
// 			}
// 		],
// 		"name": "NewHolon",
// 		"type": "event"
// 	},
// 	{
// 		"inputs": [
// 			{
// 				"internalType": "string",
// 				"name": "_name",
// 				"type": "string"
// 			}
// 		],
// 		"name": "getFlavorAddress",
// 		"outputs": [
// 			{
// 				"internalType": "address",
// 				"name": "",
// 				"type": "address"
// 			}
// 		],
// 		"stateMutability": "view",
// 		"type": "function"
// 	},
// 	{
// 		"inputs": [
// 			{
// 				"internalType": "uint256",
// 				"name": "",
// 				"type": "uint256"
// 			}
// 		],
// 		"name": "knownflavors",
// 		"outputs": [
// 			{
// 				"internalType": "string",
// 				"name": "",
// 				"type": "string"
// 			}
// 		],
// 		"stateMutability": "view",
// 		"type": "function"
// 	},
// 	{
// 		"inputs": [],
// 		"name": "listFlavors",
// 		"outputs": [
// 			{
// 				"internalType": "string[]",
// 				"name": "",
// 				"type": "string[]"
// 			}
// 		],
// 		"stateMutability": "view",
// 		"type": "function"
// 	},
// 	{
// 		"inputs": [],
// 		"name": "listHolons",
// 		"outputs": [
// 			{
// 				"internalType": "address[]",
// 				"name": "",
// 				"type": "address[]"
// 			}
// 		],
// 		"stateMutability": "view",
// 		"type": "function"
// 	},
// 	{
// 		"inputs": [
// 			{
// 				"internalType": "address",
// 				"name": "_address",
// 				"type": "address"
// 			}
// 		],
// 		"name": "listHolonsOf",
// 		"outputs": [
// 			{
// 				"internalType": "address[]",
// 				"name": "",
// 				"type": "address[]"
// 			}
// 		],
// 		"stateMutability": "view",
// 		"type": "function"
// 	},
// 	{
// 		"inputs": [
// 			{
// 				"internalType": "string",
// 				"name": "",
// 				"type": "string"
// 			}
// 		],
// 		"name": "toAddress",
// 		"outputs": [
// 			{
// 				"internalType": "address",
// 				"name": "",
// 				"type": "address"
// 			}
// 		],
// 		"stateMutability": "view",
// 		"type": "function"
// 	}
// ]

class Holons {
    constructor(provider, contractAddress, abi) {
        this.web3 = new Web3(provider);
        this.holonsContract = new this.web3.eth.Contract(abi, contractAddress);
        this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
        //unlock account
        
        this.web3.eth.accounts.wallet.add(this.account);
        this.web3.eth.defaultAccount = this.account.address;
    }

    async newFlavor( _flavorname, _flavoraddress) {

      let limit;
      await this.web3.eth
        .estimateGas(
          {
            from: this.account.address,
            to: "0xAED01C776d98303eE080D25A21f0a42D94a86D9c",
            value: this.web3.utils.toWei("0.0001", "ether"),
          },
          "latest",
          ETH_DATA_FORMAT,
        )
        .then((value) => {
          limit = value;
        });
      const tx = {
       from: this.account.address,
       to: this.holonsContract.options.address,
       //value: this.web3.utils.toWei("0", "ether"),
       data: this.holonsContract.methods.newFlavor('Appreciative2',"0xAED01C776d98303eE080D25A21f0a42D94a86D9c").encodeABI(),
       gas: 210000,
       nonce: await this.web3.eth.getTransactionCount(this.account.address),
       maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
       maxFeePerGas: this.web3.utils.toWei("3000", "gwei"),
       chainId: 11155111,
       type: 0x2
      };
      return await this.sendSignedTransaction(tx);
        

        //
        //
        //

         tx = this.holonsContract.methods.newFlavor(_flavorname, _flavoraddress);
        const receipt = await tx
          .send({
            from: this.account.address,
            gas: await tx.estimateGas(),
          })
          .once("transactionHash", (txhash) => {
            console.log(`Mining transaction ...`);
            console.log(`https://${network}.etherscan.io/tx/${txhash}`);
          });
        // The transaction is now on chain!
        console.log(`Mined in block ${receipt.blockNumber}`);
      }
       // return await tx.send({from: account});
    

    async newHolon( _name, _parameter) {
       // const tx = this.holonsContract.methods.newHolon(_flavor, _name, _parameter);
       let limit;
       await this.web3.eth
         .estimateGas(
           {
             from: this.account.address,
             to:this.holonsContract.options.address,
             value: this.web3.utils.toWei("0", "ether"),
           },
           "latest",
           ETH_DATA_FORMAT,
         )
         .then((value) => {
           limit = value;
         });
       const tx = {
        from: this.account.address,
        to: this.holonsContract.options.address,
        value: this.web3.utils.toWei("0", "ether"),
        data: this.holonsContract.methods.newHolon( 'Test2pp2', 0).encodeABI(),
        gas: 3000000,
        nonce: await this.web3.eth.getTransactionCount(this.account.address),
        maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
        maxFeePerGas: this.web3.utils.toWei("3000", "gwei"),
        chainId: 11155111,
        type: 0x2,
      };
        // const tx = {
        //   from: this.account.address,
        //   to: this.holonsContract.options.address,
        //   data: this.holonsContract.methods.newHolon('Appreciative', 'Test', 0).encodeABI(),
        //   gas: await this.holonsContract.methods.newHolon('Appreciative', 'Test', 0).estimateGas({ from: this.account.address }),
        //   noonce: await this.web3.eth.getTransactionCount(this.account.address, 'pending'),
        //   gasPrice: await this.web3.eth.getGasPrice(),
        // };
        return await this.sendSignedTransaction(tx);
    }

    async getFlavorAddress(_name) {
        return await this.holonsContract.methods.getFlavorAddress(_name).call();
    }

    async listFlavors() {
        return await this.holonsContract.methods.listFlavors().call();
    }

    async listHolons() {
        return await this.holonsContract.methods.listHolons().call();
    }

    async listHolonsOf(_address) {
        return await this.holonsContract.methods.listHolonsOf(_address).call();
    }


    async sendSignedTransaction(tx) {
      
        const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
        const receipt = await this.web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction);
        return receipt;

    }
    // async sendSignedTransaction(txObject) {
      
    //   const tx = {
  
    //       'from': this.web3.eth.defaultAccount,
    //       'to': txObject.address,
    //       'data': txObject.encodeABI(),
    //       'nonce': await this.web3.eth.getTransactionCount(this.web3.eth.defaultAccount, 'pending'),
    //       'gas': await txObject.estimateGas({ from: this.web3.eth.defaultAccount }),
    //       'gasPrice': await this.web3.eth.getGasPrice(),
    //   };

  //     const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
  //     const txReceipt = await this.web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction);
  //     return txReceipt;
  // }
    
  }

// (async () => {

//   const holons = await new Holons(provider, contractAddress, abi);
//  const newholon = await holons.newHolon('Test', 0);
//  console.log(newholon);
// // let newholon = await txObject.send({ from: holons.account.address });
// // let holonlist = await holons.listHolons();
// //console.log(holonlist);
// let balance = await holons.web3.eth.getBalance(holons.account.address);
// console.log(balance);
// // let flavors = await holons.newFlavor("Appreciative2", "0x9065eF317cA9701BB0fdd90384D0994B897E96eF");
// // // console.log(flavors);
// // let flavors = await holons.listFlavors();
// // console.log(flavors);
// // //let flavoraddress = await holons.getFlavorAddress('Appreciative');
// // //let newflavor = await holons.new(holons.account.address, 'Appreciative2',flavoraddress)
// // //console.log(newflavor);
// // let holonlist = await holons.listHolons();
// // console.log(holonlist);
// })();