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
import "./IHolonFactory.sol";
import "./Holon.sol";

contract Appreciative is Holon  {
    //======================== Structures for tracking appreciation
    uint256 public totalappreciation;               // max amount of appreciation in this holon
    mapping (address => uint256) public receivedappreciation; //appreciaton received by a member
    mapping (address => uint8) public remainingappreciation; //appreciation left to give (max=100)
    mapping (address => mapping (address => uint8)) public appreciation; //appreciation given to a member by another member

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
        require (_memberaddress != msg.sender || !(_memberaddress == msg.sender && _percentage > 0), "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.
        require (remainingappreciation[msg.sender] >= _percentage, "Not enough appreciation remaining");
        remainingappreciation[msg.sender] -= _percentage;
        appreciation[msg.sender][_memberaddress] += _percentage;
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

    /// @dev Sets appreciation for all members at once
    /// @notice all members should be listed, and the sum of the percentages should be 100
    /// @notice Only the holon members can call this function
    /// @notice A member cannot send appreciation to himself (should send 0)
    function setMembersAppreciation(address[] memory _memberaddress, uint8[] memory _percentage)
        external
    {
        require(_memberaddress.length == _percentage.length && _memberaddress.length == _members.length, "Array length mismatch");
        totalappreciation -= 100 - remainingappreciation[msg.sender];
        remainingappreciation[msg.sender] = 100;

         for (uint256 i = 0; i < _memberaddress.length; i++) {
            require (remainingappreciation[msg.sender] >= _percentage[i], "Not enough appreciation remaining");
            require (isMember[msg.sender] || isMember[_memberaddress[i]], "Sender or Receiver is not a member");
            require ( !(_memberaddress[i] == msg.sender && _percentage[i] > 0), "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.
            remainingappreciation[msg.sender] -= _percentage[i];
            if (appreciation[msg.sender][_memberaddress[i]] >0)
                totalappreciation -= appreciation[msg.sender][_memberaddress[i]];
            appreciation[msg.sender][_memberaddress[i]] = _percentage[i];
            totalappreciation += _percentage[i];
         }
    }
     /// @dev Sets appreciation for a single member
    /// @notice Only the holon members can call this function
    /// @notice A member cannot send appreciation to himself (should send 0)
    /// @notice Sender should have enough appreciation left to give
    /// @param _memberaddress The address of the receiving member
    /// @param _percentage The amount of the appreciation to give in percentage.
        function setAppreciation(address  _memberaddress, uint8  _percentage)
        external
    {
        require (isMember[msg.sender] || isMember[_memberaddress], "Sender or Receiver is not a member");
        require ( !(_memberaddress == msg.sender && _percentage > 0), "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.

        //recuperate previous appreciation
        if (appreciation[msg.sender][_memberaddress] > 0) {
            totalappreciation -= appreciation[msg.sender][_memberaddress];
            remainingappreciation[msg.sender] += appreciation[msg.sender][_memberaddress];
            appreciation[msg.sender][_memberaddress] = 0;
        }
        
        require (remainingappreciation[msg.sender] >= _percentage, "Not enough appreciation remaining");
        appreciation[msg.sender][_memberaddress] = _percentage;
        remainingappreciation[msg.sender] -= _percentage;
        totalappreciation += _percentage;
         
    }

   /// @dev Resets appreciation of the caller
    /// @notice Only the holon members can call this function
    /// @notice Appreciation of all members is reset to 0
    /// @notice Appreciation left to give is reset to 100
    function resetAppreciation()
        external
    {
        require(isMember[msg.sender], "Only members can reset their appreciation");
         totalappreciation -= 100 - remainingappreciation[msg.sender];
         remainingappreciation[msg.sender] = 100;
         for (uint256 i = 0; i < _members.length; i++) {  
             appreciation[msg.sender][_members[i]] = 0;
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
                amount = receivedappreciation[_members[i]] * ( _tokenamount / totalappreciation); //multiply given appreciation with unit reward
            else
                amount = _tokenamount / _members.length; //else use blanket unit reward value.

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
                 //emit MemberRewarded(_members[i], "ERC20", amount); 
            }
        }
       // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
    }
   
}