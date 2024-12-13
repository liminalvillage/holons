import { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import * as fs from "fs";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("ManagedHolon", function () {
  let owner: Signer;
  let A1: Signer;
  let B1: Signer;
  let B2: Signer;
  let B3: Signer;

  let Managed: any;
  let Holons: any;
  let TestToken: any;
  let deploymentData: any;

  before(async function () {
    try {

      // Get the network name from command-line arguments, for example npx hardhat run test/hardhat/ManagedHolonTest.ts --network virtualtestnet ( for tenderly )(default to localhost if not provided)
      const args = process.argv.slice(2); // Fetch arguments after `node script.js`
      const networkArgIndex = args.indexOf("--network");
      const network = networkArgIndex !== -1 && args[networkArgIndex + 1] ? args[networkArgIndex + 1] : "localhost";
      
      [owner, A1, B1, B2, B3] = await ethers.getSigners();

      // Load deployment data for the specified network
      deploymentData = JSON.parse(fs.readFileSync("deployment.json", "utf-8"))[network];

      // Get factory instances
      Managed = await ethers.getContractAt("Managed", deploymentData.Managed);
      Holons = await ethers.getContractAt("Holons", deploymentData.Holons);
      TestToken = await ethers.getContractAt("TestToken", deploymentData.TestToken);

    } catch (error) {
      console.error("Setup error:", error);
      throw error;
    }
  });
    //TODO: Move this to separate file -> hardhat/test/fixtures/appreciativeHolonCreation.ts
    async function createAppreciativeHolonFixture() {

      let appreciativeHolonAAddress;

      const [owner] = await ethers.getSigners();
      const Holons = await ethers.getContractAt("Holons", deploymentData.Holons); 
      
      const flavors = await Holons.listFlavors();
      // deploy Holon ( Appreciative, A, 0 )
      try {
        const tx = await Holons.connect(owner).newHolon("Appreciative", "A", 0);
        const receipt = await tx.wait(); // Wait for the transaction to be mined
        // console.log("Holon created successfully. Transaction receipt:", receipt);
      } catch (error) {
        console.error("Error creating holon:", error);
      }
      // get it's address
      try {
        appreciativeHolonAAddress = await Holons.toAddress("A");
        console.log("Appreciative A holon created successfully. Holons.toAddress() result:", appreciativeHolonAAddress);
      } catch (error) {
        console.error("Error calling Holons.toAddress(`A`) function:", error);
      }
      return { 
        appreciativeHolonAAddress
      };
    }
    
    // TODO: Move this to separate file -> hardhat/test/fixtures/createManagedHolonCreation.ts
    async function createManagedHolonFixture(name: string) {

      let managedHolonAddress;

      const [owner] = await ethers.getSigners();
      const Holons = await ethers.getContractAt("Holons", deploymentData.Holons); 
      
      const flavors = await Holons.listFlavors();
      // deploy Holon ( Managed, B, 0 )
      try {
        const tx = await Holons.connect(owner).newHolon("Managed", name, 0);
        const receipt = await tx.wait(); // Wait for the transaction to be mined
        // console.log("Holon created successfully. Transaction receipt:", receipt);
      } catch (error) {
        console.error("Error creating holon:", error);
      }
      // get it's address
      try {
        managedHolonAddress = await Holons.toAddress(name as string);
        console.log("Managed B holon created successfully. Holons.toAddress() result:", managedHolonAddress);
      } catch (error) {
        console.error("Error calling Holons.toAddress(`B`) function:", error);
      }
    
      return { 
        managedHolonAddress
      };
    }
  
    describe("Holon Creation Tests", function () {
      it("Creates and retrieves a new Holon", async function () {
        const { appreciativeHolonAAddress } = await loadFixture(createAppreciativeHolonFixture);
  
        expect(appreciativeHolonAAddress).to.not.equal(ethers.ZeroAddress);
        console.log("Appreciative Holon Address:", appreciativeHolonAAddress);
      });
  
      it("Verifies the size of the newly created Holon", async function () {
        const { appreciativeHolonAAddress } = await loadFixture(createAppreciativeHolonFixture);
        const holonInstance = await ethers.getContractAt("Appreciative", appreciativeHolonAAddress as string);
  
        const holonSize = await holonInstance.getSize();
        expect(holonSize).to.equal(0);
      });
    });

    it("Ensures flavor 'Appreciative' is initialized", async function () {

      const Holons = await ethers.getContractAt("Holons", deploymentData.Holons);
      // Fetch the flavor address for 'Appreciative'
      const flavorAddress = await Holons.getFlavorAddress("Appreciative");
    
      // Expect the flavor address to not be the zero address
      expect(flavorAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Prevents unauthorized accounts from adding members", async function () {
      const { managedHolonAddress } = await createManagedHolonFixture("UnauthorizedAccessManagedHolon");
      const holonInstance = await ethers.getContractAt("Managed", managedHolonAddress as string);
    
      const unknownMember = A1; // `A1` is not the creator
    
      // Attempt to add a member using an unauthorized account
      await expect(
        holonInstance.connect(unknownMember).addMembers(["UnauthorizedMember"])
      ).to.be.revertedWith("Only creator can add members");
    
      // Verify that no members were added
      const size = await holonInstance.getSize();
      expect(size).to.equal(0);
    });
    

  describe("Member Management Tests", function () {
      it("Adds members to a Managed Holon", async function () {
        const { managedHolonAddress } = await createManagedHolonFixture("MemberManagmentManagedHolon");
        const holonInstance = await ethers.getContractAt("Managed", managedHolonAddress as string);
  
        await holonInstance.connect(owner).addMembers(["B1", "B2"]);
  
        const size = await holonInstance.getSize();
        expect(size).to.equal(2);
  
        console.log("Managed Holon Size after adding members:", size);
      });
  
      it("Prevents duplicate member addition", async function () {
        const { managedHolonAddress } = await createManagedHolonFixture("DuplicateMemberManagedHolon");
        const holonInstance = await ethers.getContractAt("Managed", managedHolonAddress as string);
      
        // Add the first member
        await holonInstance.connect(owner).addMembers(["B1"]);
        
        // Check that adding the same member again doesn't increase the size
        const sizeBefore = await holonInstance.getSize();
        await holonInstance.connect(owner).addMembers(["B1"]); // Should return early without changes
        const sizeAfter = await holonInstance.getSize();
      
        // Assert that the size remains unchanged
        expect(sizeBefore).to.equal(1);
        expect(sizeAfter).to.equal(1);
      
        console.log("Managed Holon size after duplicate addition attempt:", sizeAfter);
      });
    });

    it("Adds a second member", async function () {
      const { managedHolonAddress } = await createManagedHolonFixture("SecondMemeberManagedHolon");
      const holonInstance = await ethers.getContractAt("Managed", managedHolonAddress as string);
    
      // Add the first member
      await holonInstance.connect(owner).addMembers(["B1"]);
    
      // Add a second member
      await holonInstance.connect(owner).addMembers(["B2"]);
    
      // Verify the size of the Holon
      const holonSize = await holonInstance.getSize();
      expect(holonSize).to.equal(2);
    
      console.log("Managed Holon size after adding a second member:", holonSize);
    });

    describe("Reward Tests", function () {
      it("Rewards Ether to current users based on appreciation", async function () {
        const { managedHolonAddress } = await createManagedHolonFixture("EtherTestManagedHolon");
        const holonInstance = await ethers.getContractAt("Managed", managedHolonAddress as string);
      
        // Add members
        await holonInstance.connect(owner).addMembers(["B1", "B3"]);

        console.log("Sucessfully added members!");
      
        // Set appreciation values
        await holonInstance.connect(owner).setAppreciation(["B1", "B3"], [60, 40]);

        console.log("Sucessfully set appreciation!");    
        
        // Check Ether balance before reward
        const etherBalanceBeforeB1 = await holonInstance.etherBalance("B1");
        const etherBalanceBeforeB3 = await holonInstance.etherBalance("B3");
      
        // Send Ether to the Holon contract

        await owner.sendTransaction({
          to: holonInstance,
          value: ethers.parseEther("1.2"),
        });

        console.log("Ether to contract send successfully");

        const contractBalance = await ethers.provider.getBalance(managedHolonAddress as string);
        console.log("Contract Ether Balance:", ethers.formatEther(contractBalance));

        // Necessary to deposit Ether for userIds
        // await holonInstance.connect(owner).depositEtherForUser("B1", ethers.parseEther("0.6"));
        // await holonInstance.connect(owner).depositEtherForUser("B3", ethers.parseEther("0.4"));
        // console.log("Successfully deposited Ether for users!");
        
        // Necessary to attach actual addresses to userIds
        const B1Address = await B1.getAddress();
        const B3Address = await B3.getAddress();

        console.log("Beneficiary Address for B1:", B1Address);
        console.log("Beneficiary Address for B3:", B3Address);

        // await holonInstance.connect(owner).claim("B1", B1Address, { gasLimit: 400000 });
        // await holonInstance.connect(owner).claim("B3", B3Address, { gasLimit: 400000 });

        console.log("Users claimed Ether, addresses mapped!");

        // Reward Ether to members
        await holonInstance.connect(owner).reward(ethers.ZeroAddress, ethers.parseEther("1"));

        console.log("Sucessfully reward transaction!")
      
        // Check Ether balance after reward
        const etherBalanceAfterB1 = await holonInstance.etherBalance("B1");
        const etherBalanceAfterB3 = await holonInstance.etherBalance("B3");
      
        // Verify balances based on appreciation
        expect(etherBalanceAfterB1 - etherBalanceBeforeB1).to.equal(ethers.parseEther("0.6")); // 60%
        expect(etherBalanceAfterB3 - etherBalanceBeforeB3).to.equal(ethers.parseEther("0.4")); // 40%
      
        console.log("Ether rewarded successfully based on appreciation:");
        console.log("B1 Ether Balance:", ethers.formatEther(etherBalanceAfterB1));
        // console.log("B2 Ether Balance:", ethers.formatEther(etherBalanceBeforeB3));
      });
    
      // it("Rewards Tokens to current users based on appreciation", async function () {
      //   const { managedHolonBAddress } = await loadFixture(createManagedHolonFixture);

      //   const holonInstance = await ethers.getContractAt("Managed", managedHolonBAddress as string);
      //   // Add members
      //   await holonInstance.connect(owner).addMembers(["B1", "B2"]);        
      //   // Set appreciation values
      //   await holonInstance.connect(owner).setAppreciation(["B1", "B2"], [60, 40]);

      //   const B1Address = await B1.getAddress();
      //   const B2Address = await B2.getAddress();

      //   const testTokenAddress = await TestToken.getAddress()
      //   // Send tokens to the Holon contract
      //   await TestToken.connect(owner).transfer(managedHolonBAddress, 1002);

      //   await holonInstance.connect(owner).depositTokenForUser("B1", testTokenAddress, 1);

      //   await holonInstance.connect(owner).depositTokenForUser("B2", testTokenAddress, 1);
      //   // Necessary in order to attach actual addresses to usersIds
      //   await holonInstance.connect(owner).claim("B1", B1Address);
      //   // Necessary in order to attach actual addresses to usersIds
      //   await holonInstance.connect(owner).claim("B2", B2Address);
      //   // Reward tokens to members
      //   await holonInstance.connect(owner).reward(testTokenAddress, 1000);
      //   // Verify balances based on appreciation
      //   const tokenBalanceB1 = await TestToken.balanceOf(B1Address);
      //   const tokenBalanceB2 = await TestToken.balanceOf(B2Address);

      //   expect(tokenBalanceB1).to.equal(601); // 60% of 1000 + 1 to attach address to userId
      //   expect(tokenBalanceB2).to.equal(401); // 40% of 1000 + 1 to attach address to userId
      // });
    // });


  // describe("Reward Tests Appreciative -> Managed", function () {
  //   it("Rewards Tokens to another Holon as its address", async function () {

  //     const { appreciativeHolonAAddress: appreciativeHolonAAddress } = await createAppreciativeHolonFixture();
  //     const { managedHolonAddress: managedHolonBAddress } = await createManagedHolonFixture("childManaged");

  //     console.log("*Child managed address: ", managedHolonBAddress);

  //     // Get contract instances based on contract addresses
  //     const holonA = await ethers.getContractAt("Appreciative", appreciativeHolonAAddress as string);
  //     const holonB = await ethers.getContractAt("Managed", managedHolonBAddress as string);

  //     // Test conditions: 
  //     // Holon A, members = A1, HolonB
  //     // Holon B, members = B1, B2
  //     let A1Address = await A1.getAddress();
  //     let B1Address = await B1.getAddress();
  //     let B2Address = await B2.getAddress();

  //     // Add members to the HolonsA ( comment out while incrementaly testing, as it will cause an errors [already inserted ] )

  //     // Managed has an issue - AddMember ( as in other holons)  is not the same - because adding member, requires name. 
  //     await holonB.connect(owner).addMembers(["B1", "B2"]);

  //     await holonA.connect(owner).addMember(A1Address, "1");
  //     console.log("Added member A1 to HolonA");

  //     await holonA.connect(owner).addMember(holonB, "2");
  //     console.log("Added member HolonB to HolonA");
  
  //     await TestToken.connect(owner).transfer(holonA, 1000);

  //     const holonAInitialBalance = await TestToken.connect(owner).balanceOf(holonA);
    
  //     console.log("holonAInitialBalance: ", holonAInitialBalance);

  //     const testTokenAddress = await TestToken.getAddress();

  //     const A1AddressBeforeReward = await TestToken.connect(owner).balanceOf(A1Address);

  //     console.log("A1AddressBeforeReward: ", A1AddressBeforeReward);

  //     console.log("HolonB related logs...")

  //     const holonBUsersLength = await holonB.connect(owner).getSize();

  //     console.log("Number of users in HolonB:", holonBUsersLength);

  //     const userIds = [];
  //     for (let i = 0; i < holonBUsersLength; i++) {
  //         const userId = await holonB.connect(owner).userIds(i);
  //         userIds.push(userId);
  //     }
  //     console.log("All User IDs:", userIds);

  //     // await TestToken.connect(owner).transfer(holonB, 100)

  //     // await holonB.connect(owner).depositTokenForUser("B1", testTokenAddress, 1);

  //     // await holonB.connect(owner).depositTokenForUser("B2", testTokenAddress, 1);

  //     // console.log("Tokens deposited for users B1 and B2");

  //     // await holonB.connect(owner).claim("B1", B1Address);

  //     // await holonB.connect(owner).claim("B2", B2Address);

  //     console.log("Users B1 and B2 claimed their tokens, addresses assigned");

  //     await holonA.connect(owner).reward(testTokenAddress, 1000);

  //     await holonB.connect(owner).claim("B1", B1Address);

  //     await holonB.connect(owner).claim("B2", B2Address);

  //     const A1AddressAfterReward = await TestToken.connect(owner).balanceOf(A1Address);

  //     console.log("A1AddressAfterReward: ", A1AddressAfterReward);

  //     // expect(A1AddressAfterReward).to.equal(500);
  //     const B1AddressBalance = await TestToken.connect(owner).balanceOf(B1Address); 
  //     console.log("Member 'B1AddressBalance' token balance:", B1AddressBalance.toString());

  //     expect(B1AddressBalance).to.equal(250); // should be 250 but we had to add + 1 that was necessary for Managed holon to register the address for specific user id

  //     const B2AddressBalance = await TestToken.connect(owner).balanceOf(B2Address); 
  //     console.log("Member 'B2AddressBalance' token balance:", B2AddressBalance.toString());

  //     expect(B2AddressBalance).to.equal(250); // should be 250 but we had to add + 1 that was necessary for Managed holon to register the address for specific user id
  //   });
  // });

  // describe("Reward Tests Managed -> Managed", function () {
  //   it("Rewards Tokens to another Holon as its address", async function () {

  //     const { managedHolonAddress: parentAddress } = await createManagedHolonFixture("parent");
  //     const { managedHolonAddress: childAddress } = await createManagedHolonFixture("child");

  //     console.log("*parentAddress: ", parentAddress);
  //     console.log("*childAddress: ", childAddress);

  //     // Get contract instances based on contract addresses
  //     const parent = await ethers.getContractAt("Managed", parentAddress as string);
  //     const child = await ethers.getContractAt("Managed", childAddress as string);

  //     // Test conditions: 
  //     // Holon A, members = A1, HolonB
  //     // Holon B, members = B1, B2
  //     // let A1Address = await A1.getAddress();
  //     let B1Address = await B1.getAddress();
  //     let B2Address = await B2.getAddress();

  //     // Add members to the HolonsA ( comment out while incrementaly testing, as it will cause an errors [already inserted ] )

  //     // Managed has an issue - AddMember ( as in other holons)  is not the same - because adding member, requires name. 
  //     await child.connect(owner).addMembers(["B1", "B2"]);

  //     await parent.connect(owner).addMembers(["1"]);
  //     console.log("Added member A1 to HolonA");

  //     // await parent.connect(owner).addMember(child, "2");
  //     // console.log("Added member HolonB to HolonA");
  
  //     await TestToken.connect(owner).transfer(parent, 1000);

  //     const parentInitialBalance = await TestToken.connect(owner).balanceOf(parent);
    
  //     console.log("parentInitialBalance: ", parentInitialBalance);

  //     const testTokenAddress = await TestToken.getAddress();

  //     console.log("child related logs...")

  //     const childUsersLength = await child.connect(owner).getSize();

  //     console.log("Number of users in child:", childUsersLength);

  //     const userIds = [];
  //     for (let i = 0; i < childUsersLength; i++) {
  //         const userId = await child.connect(owner).userIds(i);
  //         userIds.push(userId);
  //     }
  //     console.log("All User IDs:", userIds);

  //     console.log("Users B1 and B2 claimed their tokens, addresses assigned");

  //     await parent.connect(owner).claim("1", childAddress as string);

  //     await parent.connect(owner).reward(testTokenAddress, 1000);

  //     const childUnclaimedBalance = await child.connect(owner).tokenBalance("B1", testTokenAddress);
      
  //     console.log("childUnclaimedBalance", childUnclaimedBalance);

  //     await child.connect(owner).claim("B2", B2Address);

  //     // expect(A1AddressAfterReward).to.equal(500);
  //     const B1AddressBalance = await TestToken.connect(owner).balanceOf(B1Address); 
  //     console.log("Member 'B1AddressBalance' token balance:", B1AddressBalance.toString());

  //     // expect(B1AddressBalance).to.equal(500); // should be 250 but we had to add + 1 that was necessary for Managed holon to register the address for specific user id

  //     const B2AddressBalance = await TestToken.connect(owner).balanceOf(B2Address); 
  //     console.log("Member 'B2AddressBalance' token balance:", B2AddressBalance.toString());

  //     expect(B2AddressBalance).to.equal(500); // should be 250 but we had to add + 1 that was necessary for Managed holon to register the address for specific user id
  //   });
  });
});
