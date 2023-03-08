const Migrations = artifacts.require("Migrations");
const HolonFactory = artifacts.require("HolonFactory");
const Holons = artifacts.require("Holons");
const ZonedHolonFactory = artifacts.require("ZonedHolonFactory");
const TestToken = artifacts.require("TestToken");

module.exports = function(deployer) {
  deployer.deploy(Migrations);
  deployer.deploy(Holons)
  deployer.deploy(HolonFactory);
  deployer.deploy(ZonedHolonFactory);
  deployer.deploy(TestToken,100000000);
};
