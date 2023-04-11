// SPDX-License-Identifier: MIT
pragma solidity ^0.8;


/* ---------------------------------------------------
 * This contract handles Holon creation, tracking and listing
 * The Holon initiatior is the Holon lead (owner) and he is able to add and remove members
 * from within the Holon contract
 *
 * ----------------------------------------------------
 */
interface IHolonFactory {

    function newHolon(string calldata _flavor,string calldata _name, uint _parameter) external returns (address);
    // function getName(address _address) external view returns (string memory);
    // function changeName(address _address, string calldata _name) external;
    // function isHolon(address _address) external view returns (bool);
    // function isMember(address _address) external view returns (bool);
    function listHolons() external view returns (address[] memory);
    function listHolonsOf(address _address) external view returns (address[] memory);
}