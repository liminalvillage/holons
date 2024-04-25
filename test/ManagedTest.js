 
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
                await holon.addMember ( 1,{ from: unknownMember });
            } catch (_) {}

            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "0", "Holon size not equal to 0");
            
        })

        it("Creates the first member", async () => {
            //await holon.passTheCrown();
            await holon.addMember ( 1,{ from: owner });
            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "1", "Holon size not equal to 1");
        })

        

        it("Tries to add the same member ", async () => {
            try {
                await holon.addMember ( 1 ,{ from: owner });
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
                await holon.addMember ( 2, { from: owner });
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
            await holon.setUserAppreciation(1, 100)
            // await holon.setAppreciation(2, 100)
            
            const appreciation = await holon.appreciation.call(1);
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
            await holon.setUserAppreciation(2, 100)

            
            const total2 = await holon.totalappreciation.call();
            assert.equal(total2.toString(), (parseInt(total) + 100 ).toString(), "Wrong appreciation received");

            // const appr2 = await holon.appreciation.call(firstMember,secondMember);
            // assert.equal(appr1.toString(), "9", "Wrong appreciation received");
            // assert.equal(appr2.toString(), "10", "Wrong appreciation received");

        })

        it("rewards current users, based on appreciation", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            await holon.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner })
            let  total = await holon.totalappreciation.call();
            //assert.equal(total2.toString(), (parseInt(total) - 100 ).toString(), "Wrong appreciation received");
            let  balance1 = await holon.etherBalance.call(1);
            let balance2 = await holon.etherBalance.call(2);
            assert.equal(new web3.utils.BN(balance1).toString(),new web3.utils.BN (balance2).toString(), "Wrong ether reward received")
            //assert.equal((Math.ceil(balance1 / 10000000000)).toString(), Math.ceil((balance2 - web3.utils.toWei("0.5", "ether")) / 10000000000).toString(), "Recieved different rewards");
            // const appr2 = await holon.appreciation.call(firstMember,secondMember);
            // assert.equal(appr1.toString(), "9", "Wrong appreciation received");
            // assert.equal(appr2.toString(), "10", "Wrong appreciation received");
        })

        it("Claims rewarded ether", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("ManagedTest");
            holon = await Holon.at(holonaddress);
            let  balance1 = await holon.etherBalance.call(1);
            let etherbalancebefore = await web3.eth.getBalance(firstMember);
            await holon.claim(1, firstMember,{from:owner});
            //await holon.claim.call(1, firstMember,{from:owner});
            let balance2 = await holon.etherBalance.call(1);
            let etherbalance = await web3.eth.getBalance(firstMember);
            assert.equal(balance2.toString(),0, "Wrong deposited claimed ether remaining")
            assert.equal((etherbalance - etherbalancebefore).toString(),balance1.toString() , "Wrong ether reward received")
        })

        
        // it("Sends rewards according to appreciation", async () => {
        //     // make appreciation equal
        //     await holon.appreciate(firstMember, 1, { from: secondMember }) // appreciation should now be equal to firstMember            
        //     const appr1 = await holon.appreciation.call(secondMember,firstMember);
        //     const appr2 = await holon.appreciation.call(firstMember,secondMember);
        //     assert.equal(appr1.toString(), appr2.toString(), "Appreciation not equal");

        //     // check consistent holon size
        //     const size = await holon.getSize();
        //     assert.equal(size.toString(), "2", "Wrong holon size");

        //     // check balance prior to transaction
        //     let balance1 = await web3.eth.getBalance(firstMember);
        //     await holon.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner })
        //     balance2 = await web3.eth.getBalance(firstMember);
        //     assert.equal((Math.ceil(balance1 / 10000000000)).toString(), Math.ceil((balance2 - web3.utils.toWei("0.5", "ether")) / 10000000000).toString(), "Recieved different rewards");

        // })

        // it("Sends Token rewards according to appreciation", async () => {
        //     //transfer 10 tokens to a member
        //     let token = await TestToken.deployed();
        //     await token.transfer(firstMember, 10, { from: owner });

        //     // check consistent holon size
        //     const size = await holon.getSize();
        //     assert.equal(size.toString(), "2", "Wrong holon size");

        //     // check balance prior to transaction
        //     balance1 = await token.balanceOf(firstMember);
        //     assert.equal(balance1.toString(), "10", "token transaction not functioning correctly")

        //     //approve contract to spend 1000 tokens 
        //     await token.transfer(holon.address, 1000, { from: owner });
        //     // allowance = await token.allowance(owner, holon.address);
        //     // assert.equal(allowance.toString(), "1000" .toString(), "Contract token allowance is not correct");
        //     await holon.reward(token.address, 1000, { from: owner });
        //     balance2 = await token.balanceOf(firstMember);
        //     //assert.equal((balance1+eval(500)).toString(), balance2.toString(), "Recieved different amount of reward for same appreciation");
        //     assert.equal(balance2.toString(),(parseInt(500.) + parseInt(balance1) ).toString(), "Recieved different amount of reward for same appreciation")
        // })

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