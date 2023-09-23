import Web3 from 'web3';
import { ETH_DATA_FORMAT, DEFAULT_RETURN_FORMAT } from "web3";
import config from "./config.json" assert { type: "json" };
import * as appreciative from './contracts/Appreciative.json' assert { type: "json" };
import * as appreciativefactory from './contracts/AppreciativeFactory.json' assert { type: "json" };
import  * as factory from './contracts/IHolonFactory.json' assert { type: "json" };
import  * as holonsabi from './contracts/Holons.json' assert { type: "json" };
const provider = new Web3.providers.HttpProvider(config.web3provider);
//const provider = config.web3provider;
//const contractAddress = '0x48252499296B216De59c4E0b6DdB4241e0740a13'; //old contract
//const contractAddress = '0x9065eF317cA9701BB0fdd90384D0994B897E96eF'; // HOLONS
const contractAddress = '0x8cFd463158cD16652302b21444E76BccFf3A788C' //Appreciative Factory
const privateKey = config.web3key;
//const abi = factory.default.abi;
//const abi = holonsabi.default.abi;
const abi = appreciativefactory.default.abi;


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
      // data: this.holonsContract.methods.newFlavor('Appreciative3',"0xAED01C776d98303eE080D25A21f0a42D94a86D9c").encodeABI(),
       data: this.holonsContract.methods.newHolon("testaaa", 0).encodeABI(),
       gas: 3000000,
       nonce: await this.web3.eth.getTransactionCount(this.account.address),
       maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
       maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
       chainId: 11155111,
       type: 0x2
      };
      let signedTx= await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
      return await this.sendSignedTransaction(signedTx);
        
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
      //  const tx = {
      //   from: this.account.address,
      //   to: this.holonsContract.options.address,
      //   value: this.web3.utils.toWei("0", "ether"),
      //   data: this.holonsContract.methods.newHolon( 'Appreciative','Testqwe', 0).encodeABI(),
      //   gas: 3000000,
      //   nonce: await this.web3.eth.getTransactionCount(this.account.address),
      //   maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      //   maxFeePerGas: this.web3.utils.toWei("3000", "gwei"),
      //   chainId: 11155111,
      //   type: 0x2,
      // };
        // const tx = {
        //   from: this.account.address,
        //   to: this.holonsContract.options.address,
        //   data: this.holonsContract.methods.newHolon('Appreciative', 'Test', 0).encodeABI(),
        //   gas: await this.holonsContract.methods.newHolon('Appreciative', 'Test', 0).estimateGas({ from: this.account.address }),
        //   noonce: await this.web3.eth.getTransactionCount(this.account.address, 'pending'),
        //   gasPrice: await this.web3.eth.getGasPrice(),
        // };

        const gasPrice = await web3.eth.getGasPrice();
        
        const tx = {
            from: this.account.address,
            to: this.holonsContract.options.address,
            gas: 3000000, // Adjust gas limit based on your needs
            gasPrice: gasPrice,
            data: holonsContract.methods.newHolon('Appreciative','Testest',0).encodeABI()
        };
        
        const signedTx = await web3.eth.accounts.signTransaction(tx, this.account.privateKey);
        return await this.sendSignedTransaction(signedTx);
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
      
        const receipt = await this.web3.eth.sendSignedTransaction(tx.raw || tx.rawTransaction);
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

  // const holons = await new Holons(provider, contractAddress, abi);
//  const newholon = await holons.newHolon('Test', 0);
//  console.log(newholon);
// // let newholon = await txObject.send({ from: holons.account.address });
// // let holonlist = await holons.listHolons();
// //console.log(holonlist);
// let balance = await holons.web3.eth.getBalance(holons.account.address);
// console.log(balance);
// let flavor = await holons.newFlavor("Appreciative2", "0x9065eF317cA9701BB0fdd90384D0994B897E96eF");
// console.log(flavor);
// let flavors = await holons.listFlavors();
// console.log(flavors);
// // //let flavoraddress = await holons.getFlavorAddress('Appreciative');
// // //let newflavor = await holons.new(holons.account.address, 'Appreciative2',flavoraddress)
// // //console.log(newflavor);
// // let holonlist = await holons.listHolons();
// // console.log(holonlist);
// })();