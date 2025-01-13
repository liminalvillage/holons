// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
import "./IHolonFactory.sol";
import "./Holon.sol";

contract Splitter is Holon {
 
   mapping( address => uint ) public percentages;

    constructor (address _creator, string  memory _name, uint _parameter)
    {
        name = _name;
        creator = _creator;
        flavor = "Splitter";
        owner = _creator;
    }
  
    function setSplit(address[] memory members, uint[] memory percentage) public {
        require(owner == msg.sender, "Only splitter owner can set the split");
        require(members.length == _members.length, "Members array should be equal to the full list of members");
        require(members.length == percentage.length, "Members and percentages should be equal");
        uint totalPercentage = 0;
        for (uint i = 0; i < percentage.length; i++) {
            totalPercentage += percentage[i];
        }
        require(totalPercentage == 100, "Total percentage should be 100");
        for (uint i = 0; i < members.length; i++) {
            percentages[_members[i]] = percentage[i];
        }
    }

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

        for (uint256 i = 0; i < _members.length; i++) {
           
                amount = (percentages[_members[i]] * _tokenamount) / 100; //multiply given appreciation with unit reward

            if (amount > 0 ){
                if (etherreward){
                    (bool success, ) = _members[i].call{value: amount}("");
                    require(success, "Transfer failed");
                }
                else {
                    token.transfer(_members[i],amount);
                    (bool success,) = _members[i].call(
                    abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
                    );
                    require(success, "Unable to call the reward function" );
                }
                // emit MemberRewarded(_members[i], "ERC20", amount); //TODO
            }
        }
       // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
    }
   

}
