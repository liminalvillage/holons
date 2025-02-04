
const Holon = artifacts.require("./Appreciative.sol")
const Holons = artifacts.require("./Holons.sol")
const TestToken = artifacts.require("./TestToken.sol")

contract("Holon", async accounts => {

    const owner = accounts[0]
    const firstMember = accounts[1]
    const secondMember = accounts[2]
    const unknownMember = accounts[3]

    const initHolon = async (from) => {
        const factory = await Holons.deployed()
        await factory.newHolon("Appreciative", "First", 0, { from: from });
        const holon = await Holon.at(await factory.newHolon.call("Appreciative", "First", 0, { from: from }));
        return holon;
    }

    before(async function () {
        try {
            await web3.eth.personal.unlockAccount(owner, "", 1000)
            await web3.eth.personal.unlockAccount(firstMember, "", 1000)
            await web3.eth.personal.unlockAccount(secondMember, "", 1000)
        } catch (error) {
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
            await factory.newHolon("Appreciative", "First", 0, { from: owner });
            holonaddress = await factory.newHolon.call("Appreciative", "First", 0, { from: owner });
            const holonlist = await factory.listHolonsOf(owner);
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
            assert.equal(holonsize.toString(), "0", "Holon size not equal to 0"); //TODO: IMPLEMENT BETTER TEST
        })

        it("Creates a new holon from holon", async () => {
            holon = await Holon.at(holonaddress);
            await holon.newHolon("Appreciative", "child", 0, { from: owner });
            assert((await factory.toAddress("child")));
        })

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
                await holon.addMember(firstMember, "Roberto", { from: unknownMember });
            } catch (_) { }

            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "0", "Holon size not equal to 0");

        })

        it("Creates the first member", async () => {
            //await holon.passTheCrown();
            await holon.addMember(firstMember, "Roberto", { from: owner });
            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "1", "Holon size not equal to 1");
        })



        it("Tries to add the same member ", async () => {
            try {
                await holon.addMember(firstMember, "Roberto", { from: owner });
            } catch (_) { }

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

        it("Changes member name", async () => {
            // validates right name
            let name = await holon.toName(firstMember);
            assert.equal(name.toString(), "Roberto", "Wrong Member Name Retrieved");
            // tries changing the name from an unkown Member
            try {
                await holon.changeName(firstMember, "Changed", { from: unknownMember });
            } catch (_) { }
            name = await holon.toName.call(firstMember);
            assert.equal(name.toString(), "Roberto", "An unauthorized member has changed holon name");
            // Member changinges his name
            await holon.changeName(firstMember, "RobertoChanged", { from: firstMember });
            name = await holon.toName.call(firstMember);
            assert.equal(name.toString(), "RobertoChanged", "Wrong Holon Name Retrieved");
        })

        it("Adds a second member", async () => {

            try {
                await holon.addMember(secondMember, "Josh", { from: owner });
            } catch (_) { }

            const holonsize = await holon.getSize();
            assert.equal(holonsize.toString(), "2", "Holon size not equal to 2");
        })

        // it("Creates a second Holon", async () => {
        // //check if holons can be fetched by owners
        // let address = await factory.listMembersOf(owner);
        // assert.equal(address.toString(),holonaddress.toString(),"address mismatch");

        // //let address2 = await factory.listHolonsOf(firstMember);
        // //assert.equal(address2.toString(),holonaddress2.toString(),"address 2 mismatch");
        // })
    })

    describe("Holon Appreciation Test", _ => {
        let factory;
        let holonaddress;
        let holon;

        // it("Member dishes appreciation to another member", async () => {
        //     factory = await HolonFactory.deployed();
        //     holonaddress = await factory.toAddress.call("First");
        //     holon = await Holon.at(holonaddress);

        //     await holon.appreciate (secondMember, 10, {from:firstMember})
        //     await holon.dish (firstMember, 11, {from:secondMember})
        //     const appr1 = await holon.dished.call(firstMember, secondMember);
        //     const appr2 = await holon.dished.call(secondMember, firstMember);
        //     assert.equal(appr1.toString(), "10", "Wrong appreciation received");
        //     assert.equal(appr2.toString(), "11", "Wrong appreciation received");

        // })

        it("Member shares appreciation to another member", async () => {
            factory = await Holons.deployed();
            holonaddress = await factory.toAddress.call("First");
            holon = await Holon.at(holonaddress);

            await holon.appreciate(firstMember, 9, { from: secondMember });
            await holon.appreciate(secondMember, 10, { from: firstMember });
            const appr1 = await holon.appreciation.call(firstMember);
            const appr2 = await holon.appreciation.call(secondMember);
            assert.equal(appr1.toString(), "9", "Wrong appreciation received");
            assert.equal(appr2.toString(), "10", "Wrong appreciation received");

        })

        it("Sends rewards according to appreciation", async () => {
            // make appreciation equal
            await holon.appreciate(firstMember, 1, { from: secondMember }) // appreciation should now be equal to firstMember            
            const appr1 = await holon.appreciation.call(firstMember);
            const appr2 = await holon.appreciation.call(secondMember);
            assert.equal(appr1.toString(), appr2.toString(), "Appreciation not equal");

            // check consistent holon size
            const size = await holon.getSize();
            assert.equal(size.toString(), "2", "Wrong holon size");

            // check balance prior to transaction
            let balance1 = await web3.eth.getBalance(firstMember);
            await holon.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner })
            balance2 = await web3.eth.getBalance(firstMember);
            assert.equal((Math.ceil(balance1 / 10000000000)).toString(), Math.ceil((balance2 - web3.utils.toWei("0.5", "ether")) / 10000000000).toString(), "Recieved different rewards");

        })

        it("Sends Token rewards according to appreciation", async () => {
            //transfer 10 tokens to a member
            let token = await TestToken.deployed();
            await token.transfer(firstMember, 10, { from: owner });

            // check consistent holon size
            const size = await holon.getSize();
            assert.equal(size.toString(), "2", "Wrong holon size");

            // check balance prior to transaction
            balance1 = await token.balanceOf(firstMember);
            assert.equal(balance1.toString(), "10", "token transaction not functioning correctly")

            //approve contract to spend 1000 tokens 
            await token.transfer(holon.address, 1000, { from: owner });
            //allowance = await token.allowance(owner, holon.address);
            //assert.equal(allowance.toString(), "1000" .toString(), "Contract token allowance is not correct");
            await holon.reward(token.address, 1000, { from: owner });
            balance2 = await token.balanceOf(firstMember);
            assert.equal(balance1.toString(), (eval(balance2) - eval(500)).toString(), "Recieved different amount of reward for same appreciation");
        })

        it("Tests Recursive Reward", async () => {
            //create two holons
            await factory.newHolon("Appreciative", "A", 0, { from: owner });
            let A = await factory.newHolon.call("Appreciative", "A", 0);
            let holonA = await Holon.at(A);

            await factory.newHolon("Appreciative", "B", 0, { from: owner });
            let B = await factory.newHolon.call("Appreciative", "B", 0);
            let holonB = await Holon.at(B);

            //add holon members and normal members
            await holonA.addMember(firstMember, "FirstMember", { from: owner });
            await holonA.addMember(B, "B", { from: owner });

            await holonB.addMember(secondMember, "SecondMember", { from: owner });
            await holonB.addMember(A, "A", { from: owner });

            let balance1 = await web3.eth.getBalance(firstMember);

            //reward the holons and see what happens ;)
            await holonA.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner });
            let balance2 = await web3.eth.getBalance(firstMember);
            console.log(balance1 + ' ' + balance2);

            //now try with tokens
            let token = await TestToken.deployed();
            balance1 = await token.balanceOf(firstMember);
            await token.transfer(holonB.address, 1000, { from: owner });
            await holonB.reward(token.address, 1000, { from: owner });
            balance2 = await token.balanceOf(firstMember);
            console.log(balance1 + ' ' + balance2);
            //assert(false);

        })


        it("Holon shares appreciation to another member", async () => {
            //Create an second holon from owner
            await factory.newHolon("Appreciative", "Second", 0, { from: owner });
            secondholonaddress = await factory.newHolon.call("Appreciative", "Second", 0, { from: owner });
            secondholon = await Holon.at(secondholonaddress);
            //add a member to it
            await secondholon.addMember(secondMember, "Josh", { from: owner });
            const secondholonsize = await secondholon.getSize();
            assert.equal(secondholonsize.toString(), "1", "Second holon size not equal to 1");
            //add the second holon to the original holon
            await holon.addMember(secondholonaddress, "Holon", { from: owner });
            let size = await holon.getSize();
            assert.equal(size.toString(), "3", "Holon size not equal to 3");
            //send appreciation from second holon to first member
            let appr1 = await holon.appreciation.call(firstMember);
            await secondholon.appreciateSibling(holonaddress, firstMember, 50, { from: owner });
            let appr2 = await holon.appreciation.call(firstMember);
            assert.equal(appr1.toString(), appr2.toString() - 50, "Wrong appreciation received");

            //second holon fails sending appreciation to themselves
            appr1 = await holon.appreciation.call(secondholonaddress);
            try {
                await secondholon.appreciateSibling(holonaddress, secondholonaddress, 50, { from: owner });
            } catch (_) { };
            appr2 = await holon.appreciation.call(secondholonaddress);
            assert.equal(appr1.toString(), appr2.toString(), "Wrong appreciation received (holon appreciated themselves)");

            let parents = await secondholon.listParents();
            console.log(parents);
            console.log(factory.address);
            console.log(holonaddress);

        })

    })

})
