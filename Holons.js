import Web3 from 'web3';
import { ETH_DATA_FORMAT, DEFAULT_RETURN_FORMAT } from "web3";
import 'dotenv/config'

import * as appreciative from './contracts/Appreciative.json' assert { type: "json" };
import * as appreciativefactory from './contracts/AppreciativeFactory.json' assert { type: "json" };
import * as managed from './contracts/Managed.json' assert { type: "json" };

import * as factory from './contracts/IHolonFactory.json' assert { type: "json" };
import * as holons from './contracts/Holons.json' assert { type: "json" };


export default class Holons {
  constructor(bot, db, settings) {
    this.network = process.env.NETWORK;
    this.chainId = process.env.CHAINID;
    this.bot = bot;
    this.db = db;
    this.settings = settings
    this.privateKey = process.env.WEB3KEY;
    const provider = new Web3.providers.HttpProvider(process.env.WEB3PROVIDER);
    this.web3 = new Web3(provider);
    this.holonsContract = new this.web3.eth.Contract(holons.default.abi, holons.default.networks[11155111].address);
    this.account = this.web3.eth.accounts.privateKeyToAccount(this.privateKey);
    //unlock account 
    this.web3.eth.accounts.wallet.add(this.account);
    this.web3.eth.defaultAccount = this.account.address;

    this.bot.command("createholon", async (ctx) => { this.createHolon(ctx) });
    this.bot.command("addmembers", async (ctx) => { this.addMembers(ctx) });
    this.bot.command("syncscore", async (ctx) => { this.syncScore(ctx) });
    this.bot.command("claim", async (ctx) => { this.claim(ctx) });
    this.bot.command("ethbalance", async (ctx) => { this.ethBalance(ctx) });
    this.bot.command("sendCommand", async (ctx) => { this.sendCommand(ctx) });
    
    this.bot.command("listmembers", async (ctx) => {
      const chatID = ctx.message.chat.id;
      let address = await this.holonsContract.methods.toAddress(chatID.toString()).call();
      let holon = new this.web3.eth.Contract(managed.default.abi, address);
      let members = await holon.methods.listMembers().call();
      if (members.length > 0) {
        return ctx.reply(members);
      } else {
        ctx.reply("No members found");
      }
    })

    this.bot.command("sync", async (ctx) => {
      await this.createHolon(ctx)
      await this.addMembers(ctx);
      await this.syncScore(ctx);
    }
    );

    this.bot.command("claim", async (ctx) => { this.claim(ctx) });

  }

  //pick up the balance from the holon
  async ethBalance(ctx) {
    const userID = ctx.message.from.id;
    const chatID = ctx.message.chat.id;
    let address = await this.holonsContract.methods.toAddress(chatID.toString()).call();
    let holon = new this.web3.eth.Contract(managed.default.abi, address);
    let balance = await holon.methods.etherBalance(userID.toString()).call();
    //let balance = await this.web3.eth.getBalance(this.account.address);

    ctx.reply("Eth Balance: " + balance);
  }

  async syncScore(ctx) {
    const chatID = ctx.message.chat.id;
    let users = await this.db.getAll(chatID.toString() + '/users')
    if (!users) return ctx.reply("No users found");
    const equation = await this.settings.getValueEquation(chatID)

    let userids = users.map((user) => { return user.id.toString() })
    let scores = users.map((user) => {
      return (
        user.initiated.length * equation.initiated +
        user.completed.length * equation.completed +
        user.sent * equation.sent +
        user.received * equation.received +
        user.hours * equation.hours +
        user.collaboration * equation.collaboration +
        user.wants.length * equation.wants +
        user.offers.length * equation.offers)
    })

    let address = await this.holonsContract.methods.toAddress(chatID.toString()).call();
    let holon = new this.web3.eth.Contract(managed.default.abi, address);
    //let size = await holon.methods.getSize().call();
    const tx = {
      from: this.account.address,
      to: holon.options.address,
      data: holon.methods.setAppreciation(userids, scores).encodeABI(),
      gas: 3000000,
      maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
      chainId: 11155111,
      type: 0x2
    };
    const receipt = await this.sendSignedTransaction(tx);
    if (receipt.status == true) {
       ctx.reply("Sync Successful");

    } else {
       ctx.reply("Sync Failed: " + receipt.message);
    }
    return receipt;
  }

  async claim(ctx) {
    const chatID = ctx.message.chat.id;
    const userID = ctx.message.from.id;
    let holonaddress = await this.holonsContract.methods.toAddress(chatID.toString()).call();
    let holon = new this.web3.eth.Contract(managed.default.abi, holonaddress);
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 1) {
      return ctx.reply("Usage: /claim [your wallet address on " + this.network + "]");
    }
    const address = args[0];
    const tx = {
      from: this.account.address,
      to: holon.options.address,
      data: holon.methods.claim(userID.toSting(), address).encodeABI(),
      gas: 3000000,
      nonce: await this.web3.eth.getTransactionCount(this.account.address),
      maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
      chainId: 11155111,
      type: 0x2
    };
    const receipt = await this.sendSignedTransaction(tx);
    if (receipt.status == true) {
      return ctx.reply("Claim Successful");

    } else {
      return ctx.reply("Claim Failed: " + receipt.message);
    }
    return receipt;
  }

  async createHolon(ctx) {
    const chatID = ctx.message.chat.id;
    //extract parameters from ctx
    let flavor = ctx.message.text.split(" ").slice(1).join(" ");
    if (flavor == "") {
      flavor = "Managed";
    }
    console.log(flavor);
    // check if holon already exists
    let address = await this.holonsContract.methods.toAddress(chatID.toString()).call();
    if (address != '0x0000000000000000000000000000000000000000') {
      ctx.reply("Holon address on " + this.network + ": " + address);
    } else {
      // create new holon
      const tx = {
        from: this.account.address,
        to: this.holonsContract.options.address,
        data: this.holonsContract.methods.newHolon(flavor, chatID.toString(), 0).encodeABI(),
        gas: 3000000,
        nonce: await this.web3.eth.getTransactionCount(this.account.address),
        maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
        maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
        chainId: 11155111,
        type: 0x2
      };
      let result = await this.sendSignedTransaction(tx);
      if (result.status == false) {
        return ctx.reply("Holon creation failed: " + result.message);
      }
      else {
        address = await this.holonsContract.methods.toAddress(chatID.toString()).call();
        ctx.reply("Holon address on " + this.network + ": " + address);
      }
      return address
    }
  }

  async addMembers(ctx) {
    const id = ctx.message.chat.id;
    let holonaddress = await this.holonsContract.methods.toAddress(id.toString()).call();
    // fetch users and add them to the holon
    let users = await this.db.getAll(id.toString() + '/users')

    users.forEach(async (user) => {
      if (user.id != undefined) {
        await this.addMember(holonaddress, user.id.toString());
      }
    })
  }

  async sendFunction(funct, param1, param1type, param2, param2type) {
    const functionSignature = web3.utils.sha3(funct).substr(0, 10);

// Encode parameters
const eparam1 = web3.eth.abi.encodeParameter('uint256', 123).substr(2);
const eparam2 = web3.eth.abi.encodeParameter('address', '0xYourAddress').substr(2);

// Concatenate the function signature and parameters
const data = functionSignature + eparam1 + eparam2;

// Prepare the transaction object
const transaction = {
    to: '0xContractAddress',
    from: '0xYourAddress',
    data: data,
    gas: 2000000
};

// Send the transaction
web3.eth.sendTransaction(transaction)
    .then(receipt => {
        console.log('Transaction receipt:', receipt);
    })
    .catch(error => {
        console.error('Error sending transaction:', error);
    });
  }

  //send a command to the holon
  async sendCommand(_holonaddress, _command, _args) {
    let holon = new this.web3.eth.Contract(managed.default.abi, _holonaddress);
    let tx = {
      from: this.account.address,
      to: holon.options.address,
      data: holon.methods[_command](_args).encodeABI(),
      gas: 3000000,
      nonce: await this.web3.eth.getTransactionCount(this.account.address),
      maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
      chainId: 11155111,
      type: 0x2
    };
    return await this.sendSignedTransaction(tx);
  }


  async newFlavor(_flavorname, _flavoraddress) {
    let limit;
    await this.web3.eth
      .estimateGas(
        {
          from: this.account.address,
          to: this.holonsContract.address,
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
      data: this.holonsContract.methods.newFlavor(_flavorname, _flavoraddress).encodeABI(),
      gas: 3000000,
      nonce: await this.web3.eth.getTransactionCount(this.account.address),
      maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
      chainId: 11155111,
      type: 0x2
    };

    return await this.sendSignedTransaction(tx);
  }

  async newHolon(_name, _parameter) {
    const tx = {
      from: this.account.address,
      to: this.holonsContract.options.address,
      data: this.holonsContract.methods.newHolon("Managed", _name, 0).encodeABI(),
      gas: 3000000,
      //nonce: await this.web3.eth.getTransactionCount(this.account.address),
      maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
      chainId: 11155111,
      type: 0x2
    };
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

  async addMember(_holonaddress, _userid) {

    let holon = new this.web3.eth.Contract(managed.default.abi, _holonaddress);

    if (await holon.methods.userIdToAddress(_userid.toString()) != '0x0000000000000000000000000000000000000000')
      return true; // member already exists

    const tx = {
      from: this.account.address,
      to: holon.options.address,
      data: holon.methods.addMember(_userid.toString()).encodeABI(),
      gas: 3000000,
      //nonce: await this.web3.eth.getTransactionCount(this.account.address),
      maxPriorityFeePerGas: this.web3.utils.toWei("3", "gwei"),
      maxFeePerGas: this.web3.utils.toWei("30", "gwei"),
      chainId: 11155111,
      type: 0x2
    };
 
    return  await this.sendSignedTransaction(tx);
  }


  async sendSignedTransaction(tx) {
    let signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx.raw || signedTx.rawTransaction)
      .once("transactionHash", (txhash) => {
        console.log(`Mining transaction ...`);
        console.log(`https://${this.network}.etherscan.io/tx/${txhash}`);

      }).catch((error) => { console.log(error.message); return error });
    if (receipt?.blockNumber)
      console.log(`Mined in block ${receipt.blockNumber}`);
    return receipt;
  }

}

// (async () => {

//   const holons = await new Holons();
//   //  const newholon = await holons.newHolon('Test1', 0);
//   //  console.log(newholon);

//   // let holonlist = await holons.listHolons();
//   //console.log(holonlist);
//   let balance = await holons.web3.eth.getBalance(holons.account.address);
//   console.log(balance);
//   // let flavor = await holons.newFlavor("Appreciative2", "0x9065eF317cA9701BB0fdd90384D0994B897E96eF");
//   // console.log(flavor);
//   let flavors = await holons.listHolons();
//   console.log(flavors);

//   await holons.addMember('0xB284d0d0564E4886F91803bA3D388134E7CB97cc', 12345)

//   // let holonlist = await holons.listHolons();
//   // console.log(holonlist);
// })();