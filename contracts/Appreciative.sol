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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Holon.sol";

contract Appreciative is Holon  {

    //======================== Structures for tracking appreciation
    uint256 public totalappreciation;               // max amount of appreciation in this holon
    mapping (address => uint256) public appreciation; //appreciaton received by a member
    mapping (address => uint8) public remainingappreciation; //appreciation left to give (max=100)

    constructor (address _creator, string  memory _name)
    {
        name = _name;
        creator = _creator;
        flavor = "Appreciative";
        totalappreciation = 0;
    }

      //=============================================================
    //                      Appreciative Functions
    //=============================================================
    //  these function are called to signal appreciation to others

    /// @dev Gives a percentage of appreciation to a specific member
    /// @notice Only the holon members (not contributors) can call this function
    /// @notice A member cannot send appreciation to himself
    /// @notice Sender should have enough appreciation left to give
    /// @param _memberaddress The address of the receiving member
    /// @param _percentage The amount of the appreciation to give in percentage.

    function appreciate(address _memberaddress, uint8 _percentage)
        external
    {
        require (isMember[msg.sender] || isMember[_memberaddress], "Sender or Receiver is not a member");
        require (_memberaddress != msg.sender, "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.
        require (remainingappreciation[msg.sender] >= _percentage, "Not enough appreciation remaining");
        remainingappreciation[msg.sender] -= _percentage;
        appreciation[_memberaddress] += _percentage;
        totalappreciation += _percentage;
    }

    /// @dev Gives a percentage of appreciation to a specific member
    /// @notice Only the holon members can call this function
    /// @notice A member cannot send appreciation to himself
    /// @notice Sender should have enough appreciation left to give in parent
    /// @param _parent The address of the receiving member
    /// @param _sibling The address of the receiving member
    /// @param _percentage The amount of the appreciation to give in percentage.

    function appreciateSibling(address _parent, address _sibling, uint8 _percentage)
        external
    {
        require (msg.sender == owner,"Only lead can perform this action");
        Appreciative(payable(_parent)).appreciate(_sibling,_percentage);
    }

    /// @dev Sets appreciation for a group of members
    /// @notice This is the only way to change already assigned appreciation
    function setAppreciation(address[] memory _memberaddress, uint8[] memory _percentage)
        external
    {
        require(_memberaddress.length == _percentage.length, "Array length mismatch");
        totalappreciation = 0;
         for (uint256 i = 0; i < _memberaddress.length; i++) {
             appreciation[_memberaddress[i]] = _percentage[i];
             remainingappreciation[_memberaddress[i]] -= _percentage[i];
             totalappreciation += _percentage[i];
         }
    }

   /// @dev Resets appreciation of the caller
    /// @notice This is the only way to change already assigned appreciation
    function resetAppreciation()
        external
    {
        require(msg.sender == owner, "Only the lead can reset appreciation");
        totalappreciation = 0;
         for (uint256 i = 0; i < _members.length; i++) {
             address _memberaddress = _members[i];
             remainingappreciation[_memberaddress] = 100;
             appreciation[_memberaddress] = 0;
         }
    }

    function addMember(address  _memberaddress, string memory _membername) 
         public override
    {
        super.addMember(_memberaddress,_membername);
        remainingappreciation[_memberaddress] = 100;
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
            if (totalappreciation > 0 ) // if any appreciation was shared
                amount = (appreciation[_members[i]] * _tokenamount) / totalappreciation; //multiply given appreciation with unit reward
            else
                amount = _tokenamount /_members.length ; //else use blanket unit reward value.

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
                // MemberRewarded(_members[i], "ERC20", amount); TODO
            }
        }
       // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
    }
   
}
