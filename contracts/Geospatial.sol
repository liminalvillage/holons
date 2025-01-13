// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8;

// Fixed number of roles /subholons per holon
// Roles are initially assigned by the creator of the holon, using the addMember function
// Additional roles are passed by approving proposals by the current people
// Every role has a name and a description

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

contract Geospatial is Holon{
    string[] public hexs; // list of hexs
    mapping (string => address) public hexToAddress; // mapping for hexs to addresses
    mapping (string => bool) public hasClaimed; // mapping to track if hex has already claimed
    
    mapping (string => uint256) public etherBalance; // storage for Ether by hex
    mapping (string => mapping(address => uint256)) public tokenBalance; // storage for ERC20 by hex
    mapping (string => address[]) public tokensOf; // list of received tokens for a specific hex
    
    uint256 public totalappreciation;               
    mapping (string => uint256) public appreciation; // appreciation received by a member based on hex

    constructor(address _creator, string memory _name) {
        name = _name;
        creator = _creator;
        totalappreciation = 0;
    }

    // Only the creator can add members
    function addMember(string calldata _hex) external {
        require(msg.sender == creator, "Only creator can add members");
        require(hexToAddress[_hex] == address(0), "User ID is already added");
        hexToAddress[_hex] = msg.sender;
        hexs.push(_hex);
    }

    function getSize() external override view returns (uint256) {
        return hexs.length;
    }

    // Only the creator can set appreciation for members
    function setUserAppreciation(string calldata _hex, uint256 _appreciationAmount) external {
        require(msg.sender == creator, "Only creator can set appreciation");
        totalappreciation -= appreciation[_hex]; //subtract old appreciation
        appreciation[_hex] = _appreciationAmount;
        totalappreciation += _appreciationAmount;
    }

    
    //set appreciation for an array of users
    function setAppreciation(string[] calldata _hexs, uint256[] calldata _appreciationAmounts) external {
        require(msg.sender == creator, "Only creator can set appreciation");
        require(_hexs.length == _appreciationAmounts.length, "Array lengths do not match");
        require(_hexs.length == hexs.length, "You must set appreciation for all users at once");
        totalappreciation = 0; //reset total appreciation
        for (uint i = 0; i < _hexs.length; i++) {
            appreciation[_hexs[i]] = _appreciationAmounts[i];
            totalappreciation += _appreciationAmounts[i];
        }
    }

    // Function to deposit Ether for a specific hex
    function depositEtherForUser(string calldata _hex, uint256 amount) external payable {
        etherBalance[_hex] += amount;
    }

    // Function to deposit ERC20 tokens for a specific hex
    function depositTokenForUser(string calldata _hex, address _tokenAddress, uint256 _amount) external {
        IERC20 token = IERC20(_tokenAddress);
        require(token.transferFrom(msg.sender, address(this), _amount), "Token transfer failed");
        tokenBalance[_hex][_tokenAddress] += _amount;
        tokensOf[_hex].push(_tokenAddress);
    }

    // Function for users to claim their Ether
    function claimEther(string calldata _hex, address _beneficiary) internal {
        require(msg.sender == creator, "Only creator can submit an user claim Ether");

        uint256 amount = etherBalance[_hex];
        etherBalance[_hex] = 0;
        payable(_beneficiary).transfer(amount);
    }

    // Function for users to claim their ERC20 tokens
    function claimTokens(string calldata _hex, address _beneficiary) internal {
        require(msg.sender == creator, "Only creator can submit an user claim Tokens");  
        // Loop through all tokens and transfer to user
        address[] memory tokens = tokensOf[_hex];
        for (uint i =0; i <tokensOf[_hex].length; i++){
            IERC20 token = IERC20(tokens[i]);
            uint256 amount = tokenBalance[_hex][tokens[i]];
            tokenBalance[_hex][tokens[i]] = 0;
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

        for (uint256 i = 0; i < hexs.length; i++) {
                if (totalappreciation > 0 ) // if any appreciation was shared
                    amount = (appreciation[hexs[i]] *  _tokenamount) / totalappreciation; //multiply given appreciation with unit reward
                else
                amount = _tokenamount / hexs.length; //else use blanket unit reward value.

            if (amount > 0 ){
                if (etherreward){
                    if (hasClaimed[hexs[i]]) {
                        (bool success, ) = hexToAddress[hexs[i]].call{value: amount}("");
                        require(success, "Transfer failed");
                    }
                    else
                     this.depositEtherForUser(hexs[i], amount);//hexs[i].call{value: amount}("");
                }
                else {
                    if(hasClaimed[hexs[i]]){
                        token.transfer(hexToAddress[hexs[i]],amount);
                        (bool success,) = hexToAddress[hexs[i]].call(
                        abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
                        );
                        //require(success, "Unable to call the reward function" );
                    }
                    else
                        this.depositTokenForUser (hexs[i], _tokenaddress,amount);
                }
                 //emit MemberRewarded(hexs[i], "ERC20", amount); 
            }
        }
       // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
    }

     //claim both ether and tokens
     function claim(string calldata _hex, address _beneficiary) external{
        require(!hasClaimed[_hex], "User has already claimed");
         if (hexToAddress[_hex] == address(0)) {
            hexToAddress[_hex] =_beneficiary; // Associate user ID with address on first claim
        } else {
           // require(hexToAddress[_hex] == _beneficiary, "Unauthorized");
        }
         claimEther(_hex, _beneficiary);
         claimTokens(_hex, _beneficiary);
         hasClaimed[_hex] = true;
     }

}