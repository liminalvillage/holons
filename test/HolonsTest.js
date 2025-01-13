const Holons = artifacts.require("./Holons.sol")
// const HolonFactory = artifacts.require("./HolonFactory.sol")
// const TestToken = artifacts.require("./TestToken.sol")

contract("Holons", async accounts => {

    const owner = accounts[0]
    const firstMember = accounts[1]
    const secondMember = accounts[2]
    const unknownMember = accounts[3]

    const initHolon = async (from) => {
        const factory = await Holons.deployed()
        const holon = await factory.newHolon("First", 0, {from:from});
        return holon;
    }

    before(async function () {
        try {
            await web3.eth.personal.unlockAccount(owner, "", 1000)
            await web3.eth.personal.unlockAccount(firstMember, "", 1000)
            await web3.eth.personal.unlockAccount(secondMember, "", 1000)
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

        it("Creates a new Appreciative Holon ", async () => {
            factory = await Holons.deployed();
            //create first holon
            await factory.newHolon("Appreciative", "Holon",0, { from: owner });
            holonaddress = await factory.newHolon.call("Appreciative","Holon", 0,{ from: owner });
            const holonlist = await factory.listHolonsOf(owner);
            assert.equal(holonaddress.toString(), holonlist[0].toString(), "Address mismatch");
        })

        it("Creates a new Zoned Holon ", async () => {
            factory = await Holons.deployed();
            //create first holon
            await factory.newHolon("Zoned","Zolon", 0, { from: owner });
            holonaddress = await factory.newHolon.call("Zoned","Zolon", 0, { from: owner });
            const holonlist = await factory.listHolonsOf(owner);
            assert.equal(holonaddress.toString(), holonlist[1].toString(), "Address mismatch");
        })


        it("Creates a new Managed Holon ", async () => {
            factory = await Holons.deployed();
            //create first holon
            await factory.newHolon("Managed","Managed", 0, { from: owner });
            holonaddress = await factory.newHolon.call("Managed","Managed", 0, { from: owner });
            const holonlist = await factory.listHolonsOf(owner);
            assert.equal(holonaddress.toString(), holonlist[2].toString(), "Address mismatch");
        })
    })
})
