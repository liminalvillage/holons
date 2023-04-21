//  SPDX-License-Identifier: MIT
pragma solidity ^0.8;


/* ---------------------------------------------------
 * This contract handles Holon creation, tracking and listing
 * The Holon initiatior is the Holon lead (owner) and he is able to add and remove members
 * from within the Holon contract
 *
 * ----------------------------------------------------
 */
interface IHolon {
    function reward(address _tokenaddress, uint _amount) external view returns (uint);
    function newHolon(string calldata _name, uint _parameter) external returns (bool);
    function setManifest(string calldata _manifest) external;
}