const Migrations = artifacts.require("Migrations");
const Holons = artifacts.require("Holons");
const AppreciativeFactory = artifacts.require("AppreciativeFactory");
const ZonedFactory = artifacts.require("ZonedFactory");
const TestToken = artifacts.require("TestToken");

module.exports = function(deployer) {
  deployer.deploy(Migrations);
  deployer.deploy(AppreciativeFactory);
  deployer.deploy(ZonedFactory);
  deployer.deploy(Holons).then( async (instance) => {
    await instance.newFactory("Appreciative",AppreciativeFactory.address); 
    await instance.newFactory("Zoned",ZonedFactory.address)});
  deployer.deploy(TestToken,100000000);
};
