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

contract Managed is Holon{
    uint256[] public userIds; // list of userIds
    mapping (uint256 => address) public userIdToAddress; // mapping for userIds to addresses
    mapping (uint256 => bool) public hasClaimed; // mapping to track if userId has already claimed
    
    mapping (uint256 => uint256) public etherBalance; // storage for Ether by userID
    mapping (uint256 => mapping(address => uint256)) public tokenBalance; // storage for ERC20 by userID
    mapping (uint256 => address[]) public tokensOf; // list of received tokens for a specific userID
    
    uint256 public totalappreciation;               
    mapping (uint256 => uint256) public appreciation; // appreciation received by a member based on UserID

    constructor(address _creator, string memory _name) {
        name = _name;
        creator = _creator;
        totalappreciation = 0;
    }

    // Only the creator can add members
    function addMember(uint256 _userId) external {
        require(msg.sender == creator, "Only creator can add members");
        require(userIdToAddress[_userId] == address(0), "User ID is already added");
        userIdToAddress[_userId] = msg.sender;
        userIds.push(_userId);
    }

    function getSize() external override view returns (uint256) {
        return userIds.length;
    }

    // Only the creator can set appreciation for members
    function setUserAppreciation(uint256 _userId, uint256 _appreciationAmount) external {
        require(msg.sender == creator, "Only creator can set appreciation");
        appreciation[_userId] = _appreciationAmount;
        totalappreciation += _appreciationAmount;
    }

    
    //set appreciation for an array of users
    function setAppreciation(uint256[] memory _userIds, uint256[] memory _appreciationAmounts) external {
        require(msg.sender == creator, "Only creator can set appreciation");
        require(_userIds.length == _appreciationAmounts.length, "Array lengths do not match");
        for (uint i = 0; i < _userIds.length; i++) {
            appreciation[_userIds[i]] = _appreciationAmounts[i];
            totalappreciation += _appreciationAmounts[i];
        }
    }

    // Function to deposit Ether for a specific userID
    function depositEtherForUser(uint256 _userId, uint256 amount) external payable {
        etherBalance[_userId] += amount;
    }

    // Function to deposit ERC20 tokens for a specific userID
    function depositTokenForUser(uint256 _userId, address _tokenAddress, uint256 _amount) external {
        IERC20 token = IERC20(_tokenAddress);
        require(token.transferFrom(msg.sender, address(this), _amount), "Token transfer failed");
        tokenBalance[_userId][_tokenAddress] += _amount;
        tokensOf[_userId].push(_tokenAddress);
    }

    // Function for users to claim their Ether
    function claimEther(uint256 _userId, address _beneficiary) internal {
        require(msg.sender == creator, "Only creator can submit an user claim Ether");

        uint256 amount = etherBalance[_userId];
        etherBalance[_userId] = 0;
        payable(_beneficiary).transfer(amount);
    }

    // Function for users to claim their ERC20 tokens
    function claimTokens(uint256 _userId, address _beneficiary) internal {
        require(msg.sender == creator, "Only creator can submit an user claim Tokens");  
        // Loop through all tokens and transfer to user
        address[] memory tokens = tokensOf[_userId];
        for (uint i =0; i <tokensOf[_userId].length; i++){
            IERC20 token = IERC20(tokens[i]);
            uint256 amount = tokenBalance[_userId][tokens[i]];
            tokenBalance[_userId][tokens[i]] = 0;
            token.transfer(_beneficiary, amount);
        }
    }

    
    // reward function to reward all members through their user id
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

        for (uint256 i = 0; i < userIds.length; i++) {
                if (totalappreciation > 0 ) // if any appreciation was shared
                    amount = appreciation[userIds[i]] * ( _tokenamount / totalappreciation); //multiply given appreciation with unit reward
                else
                amount = _tokenamount / userIds.length; //else use blanket unit reward value.

            if (amount > 0 ){
                if (etherreward){
                    if (hasClaimed[userIds[i]]) {
                        (bool success, ) = userIdToAddress[userIds[i]].call{value: amount}("");
                        require(success, "Transfer failed");
                    }
                    else
                     this.depositEtherForUser(userIds[i], amount);//userIds[i].call{value: amount}("");
                }
                else {
                    if(hasClaimed[userIds[i]]){
                        token.transfer(userIdToAddress[userIds[i]],amount);
                        (bool success,) = userIdToAddress[userIds[i]].call(
                        abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
                        );
                        //require(success, "Unable to call the reward function" );
                    }
                    else
                        this.depositTokenForUser (userIds[i], _tokenaddress,amount);
                }
                 //emit MemberRewarded(userIds[i], "ERC20", amount); 
            }
        }
       // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
    }

     //claim both ether and tokens
     function claim(uint256 _userId, address _beneficiary) external{
        require(!hasClaimed[_userId], "User has already claimed");
         if (userIdToAddress[_userId] == address(0)) {
            userIdToAddress[_userId] =_beneficiary; // Associate user ID with address on first claim
        } else {
           // require(userIdToAddress[_userId] == _beneficiary, "Unauthorized");
        }
         claimEther(_userId, _beneficiary);
         claimTokens(_userId, _beneficiary);
         hasClaimed[_userId] = true;
     }

}