const Holons = artifacts.require("Holons");
const AppreciativeFactory = artifacts.require("AppreciativeFactory");
const ZonedFactory = artifacts.require("ZonedFactory");
const ManagedFactory = artifacts.require("ManagedFactory");
const TestToken = artifacts.require("TestToken");

module.exports = function(deployer) {
deployer.deploy(Holons).then( async (instance) => {
    await instance.newFlavor("Appreciative",AppreciativeFactory.address); 
    await instance.newFlavor("Zoned",ZonedFactory.address);
    await instance.newFlavor("Managed",ManagedFactory.address)});
  deployer.deploy(TestToken,1000000000);
}