const assert = require('assert');
 
const Holon = artifacts.require("./Managed.sol")
const Holons = artifacts.require("./Holons.sol")
const TestToken = artifacts.require("./TestToken.sol")

contract("ManagedHolon", async accounts => {

    const owner = accounts[0]
    const firstMember = accounts[1]
    const secondMember = accounts[2]
    const thirdMember = accounts[3]
    const fourthMember = accounts[4]
    const fifthMember = accounts[5]
    const unknownMember = accounts[6]

    const initHolon = async (from) => {
        const factory = await Holons.deployed()
        //const holon = await Holon.deployed() // factory.newHolon("First", {from:from});
        return holon;
    }

    before(async function () {
        try {
            await web3.eth.personal.unlockAccount(owner, "", 1000)
            await web3.eth.personal.unlockAccount(firstMember, "", 1000)
            await web3.eth.personal.unlockAccount(secondMember, "", 1000)
            await web3.eth.personal.unlockAccount(thirdMember, "", 1000)
            await web3.eth.personal.unlockAccount(fourthMember, "", 1000)
            await web3.eth.personal.unlockAccount(fifthMember, "", 1000)
        } catch(error) {
            console.warn(`error in unlocking wallet: ${JSON.stringify(error)}`)
        }
    })

    describe("Holon Creation test", _ => {
     
        let factory;
        let holonaddress;
        let holon;
        let secondholonaddress;
        let secondholon;

        it("Creates a new Holon ", async () => {
            factory = await Holons.deployed();
            
            //create first holon
            await factory.newHolon("Managed","ManagedTest", 5,  { from: owner });
            holonaddress = await factory.newHolon.call("Managed","ManagedTest", 0,  { from: owner });
            const holonlist = await factory.toAddress("ManagedTest");
            assert.equal(holonaddress.toString(), holonlist.toString(), "Address mismatch");
        })
    
           
        // it("Fails creating a new Holon from an unknown account", async () => {
         
        //     //tries creating a rogue holon
        //     try{
        //     await factory.newHolon("Otherholon", { from: unknownMember });
        //     let holonaddress2 = await factory.newHolon.call("Otherholon");
        //     } catch{_}

        //     //check if it failed
        //     const size = await factory.getSize();
        //     assert.equal(size.toString(), "1", "size not equal to 1");
   
        // })

        // it("Fails creating a new Holon with the same name ", async () => {
        //     await factory.newHolon("First", { from: owner });
        //     const newholonaddress = await factory.newHolon.call("First", { from: owner })
        //     const size = await factory.getSize();
        //     assert.equal(size.toString(), "1", "nholons not equal to 1")
        //     //assert.equal(holonaddress, haddress2, "Holon size is not 0")
        // })

        it("Access the first holon", async () => {
            holon = await Holon.at(holonaddress);
            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "0", "Holon size not equal to 0");
        })

        // it("Creates a new holon from holon", async () => {
        //     await holon.newHolon("asdasd",5, {from:owner});
        //     console.out("asd " +  await factory.toAddress("asdasd"))
        //     //assert((await factory.toAddress("asdasd")));
        // })

        // it("Changes holon name", async () => {

        //     let name = await holon.toName.call(holonaddress);
        //     assert.equal(name.toString(), "First", "Wrong Holon Name Retrieved");
            
        //     try {
        //     await holon.changeName("Changed",{from:unknownMember});
        //     } catch (_) {}
        //     name = await holon.toName.call(holonaddress);
        //     assert.equal(name.toString(), "First", "An unauthorized member has changed holon name");

        //     try {
        //         await holon.changeName("Changed",{from:firstMember});
        //         } catch (_) {}
        //         name = await holon.toName.call(holonaddress);
        //         assert.equal(name.toString(), "First", "An unauthorized member has changed holon name");
            
        //     await holon.changeName("Changed",{from:owner});
        //     name = await holon.toName.call(holonaddress);
        //     assert.equal(name.toString(), "Changed", "Wrong Holon Name Retrieved");
        // })


 

        it("Tries creating the first member from an unknown account", async () => {
            
            try {
                await holon.addMember ( "1",{ from: unknownMember });
            } catch (_) {}

            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "0", "Holon size not equal to 0");
            
        })

        it("Creates the first member", async () => {
            //await holon.passTheCrown();
            await holon.addMember ( "1",{ from: owner });
            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "1", "Holon size not equal to 1");
        })

        

        it("Tries to add the same member ", async () => {
            try {
                await holon.addMember ( "1" ,{ from: owner });
            } catch (_) {}

            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "1", "Holon size not equal to 1");
        })

        // it("Tries to add a new member with same name", async () => {
        //     try {
        //         await holon.addMember ( secondMember, "Roberto",{ from: owner });
        //     } catch (_){}

        //     const holonsize = await holon.getSize();
        //     assert.equal(holonsize.toString(), "1", "Holon size not equal to 1");
        // })
        
        // it("Changes member name", async () => {
        //     // validates right name
            
        //     let name = await holon.toName(firstMember);
        //     assert.equal(name.toString(), "Roberto", "Wrong Member Name Retrieved");
        //     // tries changing the name from an unkown Member
        //      try{
        //         await holon.changeName(firstMember,"Changed", {from:unknownMember});
        //     } catch (_) {}
        //     name = await holon.toName.call(firstMember);
        //     assert.equal(name.toString(), "Roberto", "An unauthorized member has changed holon name");
        //     // Member changinges his name
        //     await holon.changeName(firstMember,"RobertoChanged",{from:firstMember});
        //     name = await holon.toName.call(firstMember);
        //     assert.equal(name.toString(), "RobertoChanged", "Wrong Holon Name Retrieved");
        // })

        it("Adds a second member", async () => {
            
            try {
                await holon.addMember ( "2", { from: owner });
            } catch (_){}

            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "2", "Holon size not equal to 2");
        })

        // it("Send tokens to an userId", async () => {
        //     const token = await TestToken.deployed();
        //     await token.transfer( 1000, {from:owner});
        //     const balance = await token.balanceOf(firstMember);
        //     assert.equal(balance.toString(), "1000", "Balance not equal to 1000");
        // })

    })

    describe("Managed Holon Appreciation Test", _ => {
        let factory;
        let holonaddress;
        let holon;

        // it("Member dishes appreciation to another member", async () => {
        //     factory = await Holons.deployed();
        //     holonaddress = await factory.toAddress.call("First");
        //     holon = await Holon.at(holonaddress);

        //     await holon.appreciate (secondMember, 10, {from:firstMember})
        //     await holon.dish (firstMember, 11, {from:secondMember})
        //     const appr1 = await holon.dished.call(firstMember, secondMember);
        //     const appr2 = await holon.dished.call(secondMember, firstMember);
        //     assert.equal(appr1.toString(), "10", "Wrong appreciation received");
        //     assert.equal(appr2.toString(), "11", "Wrong appreciation received");

        // })

        it("Admin sets appreciation of one member", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            await holon.setUserAppreciation("1", 100)
            // await holon.setAppreciation(2, 100)
            
            const appreciation = await holon.appreciation.call("1");
            assert.equal(appreciation.toString(), "100", "Wrong appreciation received");
            // const appr2 = await holon.appreciation.call(firstMember,secondMember);
            // assert.equal(appr1.toString(), "9", "Wrong appreciation received");
            // assert.equal(appr2.toString(), "10", "Wrong appreciation received");

        })


        it("Sets appreciation of another member, checks for total", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let  total = await holon.totalappreciation.call();
            await holon.setUserAppreciation("2", 100);            
            const total2 = await holon.totalappreciation.call();
            assert.equal(total2.toString(), (parseInt(total) + 100 ).toString(), "Wrong appreciation received");

        })

        it("Ether rewards current users, based on appreciation", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let  balancebefore = await holon.etherBalance.call("1");
            await holon.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner })
            let  total = await holon.totalappreciation.call();
            let  balance1 = await holon.etherBalance.call("1");
            let balance2 = await holon.etherBalance.call("2");

            assert.equal(new web3.utils.BN(balance1).toString(),new web3.utils.BN (balancebefore).add(new web3.utils.BN(web3.utils.toWei("0.5", "ether"))).toString(), "Wrong ether reward received")
            assert.equal(new web3.utils.BN(balance1).toString(),new web3.utils.BN (balance2).toString(), "Wrong ether reward received")
          
        })

        it("Token rewards current users, based on appreciation", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let token = await TestToken.deployed();

              //check if received tokens are correct
            let  userbalancebefore = await holon.tokenBalance.call("1", token.address);
            await token.transfer(holon.address, 10, { from: owner });
            await holon.reward(token.address, 10, { from: owner });
            let  userbalanceafter = await holon.tokenBalance.call("1", token.address);
        
            assert.equal(new web3.utils.BN(userbalanceafter).toString(),new web3.utils.BN (userbalancebefore).add(new web3.utils.BN(10/2)).toString(), "Wrong token reward received")
        })

        it ("calls reward multiple times", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let token = await TestToken.deployed();
            let balancebefore = await holon.tokenBalance("1", token.address);
            await token.transfer(holon.address, 100, { from: owner });

            await holon.reward(token.address, 100, { from: owner });
            try {
                await holon.reward(token.address, 100, { from: owner });
                await holon.reward(token.address, 100, { from: owner });
            } catch (_){}

            let balanceafter = await holon.tokenBalance("1", token.address);
            
            assert.equal((balanceafter-balancebefore).toString(), "50", "Wrong token reward received");

        })

        it("Claims rewarded ether and tokens", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let token = await TestToken.deployed();

            // check for remaining tokens and ethers to be claimed
            let  storedtokens= await holon.tokenBalance.call("1", token.address);
            assert.notEqual(storedtokens.toString(),"0", "No deposited claimed token remaining")
            let  storedeth = await holon.etherBalance.call("1");
            assert.notEqual(storedeth.toString(),"0", "No deposited claimed ether remaining")

            // check for current balances
            let etherbalancebefore = await web3.eth.getBalance(firstMember);
            let tokenbalancebefore = await  token.balanceOf(firstMember);
            // claim the rewards
            await holon.claim("1", firstMember,{from:owner});

            // makes sure nothins is stored
            let newstoredtokens = await holon.tokenBalance.call("1", token.address);
            assert.equal(newstoredtokens.toString(),"0", "Tokens still stored")
            let newstoredeth = await holon.etherBalance.call("1");
            assert.equal(newstoredeth.toString(),"0", "Ether still stored")

            // check for new balances 
            let etherbalanceafter = await web3.eth.getBalance(firstMember);
            let tokenbalanceafter = await token.balanceOf(firstMember);
            
            // check if the balances differ by the rewards
            assert.equal((tokenbalanceafter - tokenbalancebefore).toString(),storedtokens.toString() , "Wrong token reward received")
            assert.equal((etherbalanceafter - etherbalancebefore).toString(),storedeth.toString() , "Wrong ether reward received")
        
        })


        it("Directly forwards rewarded ether to claimed account", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            
            let etherbalancebefore = await web3.eth.getBalance(firstMember);
            await holon.sendTransaction({from:owner, value:web3.utils.toWei("1", "ether")});
            let etherbalanceafter = await web3.eth.getBalance(firstMember);
            assert.equal((etherbalanceafter - etherbalancebefore).toString(),web3.utils.toWei("0.5", "ether").toString() , "Wrong ether reward received")
        })


        it("Directly forwards rewarded tokens to claimed account", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let token = await TestToken.deployed();

            let balancebefore = await holon.tokenBalance("1", token.address);
            let tokenbalancebefore = await token.balanceOf(firstMember);
            await token.transfer(holon.address, 100, { from: owner });
            await holon.reward(token.address, 100, { from: owner });
            let balanceafter = await holon.tokenBalance("1", token.address);
            let tokenbalanceafter = await token.balanceOf(firstMember);
            assert.equal(balanceafter.toString(),balancebefore.toString() , "No token reward received");
            assert.equal((tokenbalanceafter-50).toString(),tokenbalancebefore.toString() , "No token reward received");
        })
        

        
        // it("Tests Recursive Reward", async () => {
        //     //create two holons
        //     await factory.newHolon("Appreciative", "A", 0, { from: owner });
        //     let A = await factory.newHolon.call("Appreciative", "A", 0);
        //     let holonA = await Holon.at(A);

        //     await factory.newHolon("Appreciative", "B", 0, { from: owner });
        //     let B = await factory.newHolon.call("Appreciative", "B", 0);
        //     let holonB = await Holon.at(B);

        //     //add holon members and normal members
        //     await holonA.addMember(firstMember, "FirstMember", { from: owner });
        //     await holonA.addMember(B, "B", { from: owner });

        //     await holonB.addMember(secondMember, "SecondMember", { from: owner });
        //     await holonB.addMember(A, "A", { from: owner });

        //     let balance1 = await web3.eth.getBalance(firstMember);

        //     //reward the holons and see what happens ;)
        //     await holonA.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner });
        //     let balance2 = await web3.eth.getBalance(firstMember);
        //     console.log(balance1 + ' - ' + balance2 +' = '+ (balance2 - balance1) );

        //     //now try with tokens
        //     let token = await TestToken.deployed();
        //     balance1 = await token.balanceOf(firstMember);
        //     await token.transfer(holonB.address, 1000, { from: owner });
        //     await holonB.reward(token.address, 1000, { from: owner });
        //     balance2 = await token.balanceOf(firstMember);
        //     console.log(balance1 + ' - ' + balance2 +' = '+ (balance2 - balance1));
        //     //assert(false);

        // })


        // it("Holon shares appreciation to another member", async () => {
        //     //Create an second holon from owner
        //     await factory.newHolon("Appreciative", "Second", 0, { from: owner });
        //     secondholonaddress = await factory.newHolon.call("Appreciative", "Second", 0, { from: owner });
        //     secondholon = await Holon.at(secondholonaddress);
        //     //add a member to it
        //     await secondholon.addMember(secondMember, "Josh", { from: owner });
        //     const secondholonsize = await secondholon.getSize();
        //     assert.equal(secondholonsize.toString(), "1", "Second holon size not equal to 1");
        //     //add the second holon to the original holon
        //     await holon.addMember(secondholonaddress, "Holon", { from: owner });
        //     let size = await holon.getSize();
        //     assert.equal(size.toString(), "3", "Holon size not equal to 3");
        //     //send appreciation from second holon to first member
        //     let appr1 = await holon.appreciation.call(secondholonaddress, firstMember);
        //     await secondholon.appreciateSibling(holonaddress, firstMember, 50, { from: owner });
        //     let appr2 = await holon.appreciation.call(secondholonaddress, firstMember);
        //     assert.equal(appr1.toString(), appr2.toString() - 50, "Wrong appreciation received");

        //     //second holon fails sending appreciation to themselves
        //     appr1 = await holon.appreciation.call(secondholonaddress,secondholonaddress);
        //     try {
        //         await secondholon.appreciateSibling(holonaddress, secondholonaddress, 50, { from: owner });
        //     } catch (_) { };
        //     appr2 = await holon.appreciation.call(secondholonaddress,secondholonaddress);
        //     assert.equal(appr1.toString(), appr2.toString(), "Wrong appreciation received (holon appreciated themselves)");

        //     let parents = await secondholon.listParents();

        // })

    })
  
})