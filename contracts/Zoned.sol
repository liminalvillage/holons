// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8;

/*
    Copyright 2020, Roberto Valenti

    This program is free software: you can use it, redistribute it and/or modify
    it under the terms of the Peer Production License as published by
    the P2P Foundation.
    
    https://wiki.p2pfoundation.net/Peer_Production_License

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    Peer Production License for more details.
 */

import "../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./IHolonFactory.sol";
import "./Holon.sol";

 contract Zoned is Holon{
    using SafeMath for uint256;

     //======================== Public holon variables
  
    uint public nzones;
    mapping (uint => address[]) public zonemembers;
    mapping  (address => uint) public zone ;

    /// @notice Constructor to create an holon
    ///  created the Holon contract, the factory needs to be deployed first

    constructor (address _creator, string  memory _name, uint _nzones)
    {
        name = _name;
        creator = _creator;
        flavor = "Zoned";

        nzones = _nzones;
        zone[tx.origin]= _nzones;
        zonemembers[_nzones].push(tx.origin);
    }

    //=============================================================
    //                      Reward Functions
    //=============================================================
    //these function will be called when a payment is sent to the holon

    /// @dev Splits the ERC20 token amount sent to the holon according to the appreciation
    /// @notice If appreciation is not shared, it splits it equally across each member (calling BlanketReward)
    function reward(address _tokenaddress, uint256 _tokenamount)
        public
        payable
        override
    {
        bool etherreward;
        IERC20 token;

        if (msg.value  > 0 && _tokenaddress == address(0)) {
            _tokenamount = msg.value;
            etherreward = true;
        }
         else {
            //Load ERC20 token information
            token = IERC20(_tokenaddress);
            require (token.balanceOf(address(this)) >= _tokenamount, "Not enough tokens in the contract");
        }
        
        uint256  amount;
        for (uint256 z = 1;  z <= nzones; z++) { //skip zone 0 as unassigned members
            if (zonemembers[z].length > 0) {
                amount = rewardFunction(z, _tokenamount).div(zonemembers[z].length); // divide reward equally for all members in the same zone
                for (uint256 i = 0; i < zonemembers[z].length; i++) {
            
            //     if (totalappreciation > 0 ) // if any appreciation was shared
            //         amount = appreciation[_members[i]].mul( _tokenamount.div(totalappreciation)); //multiply given appreciation with unit reward
            //     else
            //         amount = _tokenamount.div(_members.length); //else use blanket unit reward value.

                    if (amount > 0 ){
                        if (etherreward){
                            (bool success, ) = zonemembers[z][i].call{value: amount}("");
                            require(success, "Transfer failed");
                        }
                        else {
                            token.transfer(zonemembers[z][i],amount);
                            (bool success,) = zonemembers[z][i].call(
                            abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
                            );
                            require(success, "Unable to call the reward function" );
                        }
                        // MemberRewarded(_members[i], "ERC20", amount); TODO
                    }
                }
        // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
            }
        }
    }
    
    function rewardFunction(uint _zone, uint _totalreward) private returns (uint zonereward)
    {

        return _totalreward / nzones;//(2 ^ (_zone + 1));
    }

    function addToZone(address _memberaddress, uint _zone) public/// @notice Explain to an end user what this does
    /// @dev Explain to a developer any extra details
    /// @param Documents a parameter just like in doxygen (must be followed by parameter name)) private returns (uint zonereward)
    {
        require(zone[msg.sender] >= _zone, "members in lower zones cannot promote to higher zones"); // ch
        // TODO Cooloff period for nominations or validation of nomination
       
       
        if (zone[_memberaddress] > 0) {//if member was already in a zone
             //search and remove member from current group
            // fetch correct zone members 
            uint previouszone = zone[_memberaddress];
            for (uint256 i = 0; i < zonemembers[previouszone].length; i++) {
                if (zonemembers[previouszone][i] == _memberaddress) {
                zonemembers[previouszone][i] = zonemembers[previouszone][zonemembers[previouszone].length - 1]; //swap position with last member
                break;
                }
            }
            zonemembers[previouszone].pop(); // remove last member
        }
        
        zone[_memberaddress]= _zone;
        zonemembers[_zone].push(_memberaddress);
    }
}