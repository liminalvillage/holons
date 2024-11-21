const Migrations = artifacts.require("Migrations");
const SplitterFactory = artifacts.require("SplitterFactory");
const AppreciativeFactory = artifacts.require("AppreciativeFactory");
const ZonedFactory = artifacts.require("ZonedFactory");
const ManagedFactory = artifacts.require("ManagedFactory");
const TestToken = artifacts.require("TestToken");

module.exports = function(deployer) {
  deployer.deploy(Migrations);
  deployer.deploy(SplitterFactory);
  deployer.deploy(AppreciativeFactory);
  deployer.deploy(ZonedFactory);
  deployer.deploy(ManagedFactory);
};
