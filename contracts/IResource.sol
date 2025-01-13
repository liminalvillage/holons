// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

interface IResource {
    function requestRecipe(uint _recipeID, uint _amount, string memory _location)  external;
    function getTruePrice(uint recipeID) view external returns (uint[] memory);  
}   