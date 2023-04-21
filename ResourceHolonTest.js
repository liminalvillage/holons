const Holon = artifacts.require("./ResourceHolon.sol")
const Hackalong = artifacts.require("./HackAlong.sol")

contract("ResourceHolon", async accounts => {

    const owner = accounts[0]
    const firstMember = accounts[1]
    const secondMember = accounts[2]

    const initHolon = async (from) => {
        const factory = await Hackalong.deployed()
        const holon = await factory.newHolon("FirstRes", {from:from});
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

        it("Creates a new Holon ", async () => {
            factory = await Hackalong.deployed();
            await factory.newHolon("FirstRes", { from: owner });
            holonaddress = await factory.newHolon.call("FirstRes", { from: owner });
            
            const size = await factory.nholons();
            assert.equal(size.toString(), "1", "nholons not equal to 1")
        })
    })
});
