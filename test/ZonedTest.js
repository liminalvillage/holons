
const Holon = artifacts.require("./Zoned.sol")
const Holons = artifacts.require("./Holons.sol")
const TestToken = artifacts.require("./TestToken.sol")

contract("ZonedHolon", async accounts => {

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
            await factory.newHolon("Zoned", "Zolon", 5, { from: owner });
            holonaddress = await factory.newHolon.call("Zoned", "Zolon", 5, { from: owner });
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

        it("Check if owner is in highest zone ", async () => {
            const memberzone = await holon.zone(owner);
            const zones = await holon.nzones()
            assert.equal(memberzone.toString(), zones.toString(), "Owner is not in the highest level");
        })

        it("Promotes a member", async () => {

            try {
                await holon.addToZone(firstMember, 3, { from: owner });
            } catch (_) { }

            const memberzone = await holon.zone(firstMember);
            assert.equal(memberzone.toString(), "3", "Member did not get promoted ");
        })

        it("Fails to promote a member", async () => {

            try {
                await holon.addToZone(secondMember, 4, { from: firstMember });
            } catch (_) { }

            const memberzone = await holon.zone.call(secondMember);
            assert.equal(memberzone.toString(), "0", "Member got wrongly promoted");
        })

        it("Another member successfuly promotes a new member", async () => {

            try {
                await holon.addToZone(secondMember, 3, { from: firstMember });
            } catch (_) { }

            const memberzone = await holon.zone.call(secondMember);
            assert.equal(memberzone.toString(), "3", "Member did not get promoted");
        })

        it("Moves a member zone", async () => {

            try {
                await holon.addToZone(firstMember, 1, { from: owner });
                await holon.addToZone(secondMember, 2, { from: owner });
            } catch (_) { }

            memberzone = await holon.zone.call(firstMember);
            assert.equal(memberzone.toString(), "1", "Member zone incorrect (not moved)");
            memberzone = await holon.zone.call(secondMember);
            assert.equal(memberzone.toString(), "2", "Member zone incorrect (not moved)");
        })

        it("Rewards zones", async () => {
            await holon.addToZone(thirdMember, 3, { from: owner });
            await holon.addToZone(fourthMember, 4, { from: owner });
            //await holon.addToZone ( fifthMember, 5 ,{ from: owner });
            let balanceFirstBefore = await web3.eth.getBalance(firstMember);
            await holon.sendTransaction({ value: web3.utils.toWei("1", "ether"), from: owner })
            let balanceFirstAfter = await web3.eth.getBalance(firstMember);

            const zones = await holon.nzones()
            assert.equal(balanceFirstBefore.toString(), (balanceFirstAfter - web3.utils.toWei((1.0 / zones).toString())).toString(), "Recieved different rewards");

        })

        it("Checks if a member has been moved correctly", async () => {
            await holon.addToZone(thirdMember, 4, { from: owner });
            await holon.addToZone(thirdMember, 3, { from: owner });

        })

        it ("Rewards zones with a token", async () => {
            const token = await TestToken.deployed();
            let balanceFirstBefore = await token.balanceOf(firstMember);
            let balanceSecondBefore = await token.balanceOf(secondMember);
            let balanceThirdBefore = await token.balanceOf(thirdMember);
            let balanceFourthBefore = await token.balanceOf(fourthMember);
            let balanceFifthBefore = await token.balanceOf(fifthMember);
            let balanceUnknownBefore = await token.balanceOf(unknownMember);
            await token.transfer(holon.address, 100, { from: owner });
            await holon.reward(token.address, 100, { from: owner });

            let balanceFirstAfter = await token.balanceOf(firstMember);
            let balanceSecondAfter = await token.balanceOf(secondMember);
            let balanceThirdAfter= await token.balanceOf(thirdMember);
            let balanceFourthAfter = await token.balanceOf(fourthMember);
            let balanceFifthAfter = await token.balanceOf(fifthMember);
            let balanceUnknownAfter = await token.balanceOf(unknownMember);         
            const zones = await holon.nzones()
            assert.equal(balanceFirstBefore.toString(),(balanceFirstAfter - (100/zones)).toString() , "Recieved different rewards");
        })
    })

})