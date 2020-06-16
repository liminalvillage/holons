pragma solidity ^0.6;

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
import "./Membership.sol";

contract Holon is Membership{
    using SafeMath for uint256;

     //======================== Public holon variables
    //string public name;                             //The name of the holon
    string public version = "0.1";                  //Version of the holon contract
    string public IPFSManifest;                     //IPFS Hash for the JSON containing holon manifest
    address public creator;                         //Link to the holonic parent

    //======================== Events
    event HolonRewarded (address holon, string token, uint256 amount);
    event MemberRewarded (address member,string token, uint256 amount);

    /// @notice Constructor to create an holon
    
    ///  created the Holon contract, the factory needs to be deployed first

    constructor(address _factoryaddress) Membership(address(_factoryaddress))
        public
    {
    }

    //=============================================================
    //                      Reward Functions
    //=============================================================
    //these function will be called when a payment is sent to the holon

    receive() 
        external 
        payable 
    {
        reward(address(0),msg.value);
    }
   
    fallback()
        external
        payable
    {
        reward(address(0),msg.value);
    }

    /// @dev Splits the ERC20 token amount sent to the holon according to the appreciation
    /// @notice If appreciation is not shared, it splits it equally across each member (calling BlanketReward)
    function reward(address _tokenaddress, uint256 _tokenamount)
        public
        payable
    {
        bool etherreward;
        IERC20 token;

        if (msg.value  > 0 && _tokenaddress == address(0)) {
            _tokenamount = msg.value;
            etherreward = true;
        }
         else {
            //Load ERC20 token
            token = IERC20(_tokenaddress);
            require (token.balanceOf(address(this)) >= _tokenamount, "Not enough tokens in the contract");
        }
        
        uint256 unitReward;
        if (totalappreciation > 0 ) // if appreciation was shared
            unitReward = _tokenamount.div(totalappreciation);
        else //if no appreciation was shared, prepare unit reward for blanket approach
            unitReward = _tokenamount.div(_members.length);
        
        uint256  amount;

        for (uint256 i = 0; i < _members.length; i++) {
            if (totalappreciation > 0 ) // if appreciation was shared
                amount = appreciation[_members[i]].mul(unitReward); //multiply given appreciation with unit reward
            else
                amount = _tokenamount.div(_members.length); //else use blanket unit reward value.

            if (amount > 0 ){
                if (etherreward)
                    _transfer(_members[i], amount);
                else {
                    token.transfer(_members[i],amount);
                    //if (factory.isHolon(_members[i]))  //is holon
                    // { 
                    //     Holon holon = Holon(_members[i]);          //load holon
                    //     holon.tokenReward(_tokenaddress, amount);  //call reward function 
                    // }
                    
                    (bool success,) = _members[i].call(
                    abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
                    );
                    require(success, "Unable to call the reward function" );
                }
                MemberRewarded(_members[i], "ERC20", amount);
            }
        }
        emit HolonRewarded(address(this), "ERC20", _tokenamount);
    }

   
    // / @dev Gives a percentage of appreciation to a specific member on behalf of a specific holon
    // / @notice Only the sending holon lead can call this function
    // / @notice A member cannot send appreciation to himself
    // / @notice Sender should have enough appreciation left to give
    // / @param _fromholonaddress The address of the sending holon
    // / @param _tomemberaddress The address of the receiving member
    // / @param _percentage The amount of the appreciation to give in percentage.

    // function appreciateAsHolon(address payable _fromholonaddress, address _tomemberaddress, uint8 _percentage)
    //     public
    // {
    //     require (isMember[_fromholonaddress], "Sender is not a Holon member"); // validate sender is a Holon member
    //     require (isMember[_tomemberaddress], "Receiver is not a Holon member"); // validate receiver is a Holon member
    //     require (_tomemberaddress != _fromholonaddress, "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.
    //     require (remainingappreciation[_fromholonaddress] >= _percentage, "Not enough appreciation remaining");
    //     require (Holon(_fromholonaddress).owner() == msg.sender, "Only the Holon Lead can send appreciation on behalf of his Holon!");

    //     remainingappreciation[_fromholonaddress] -= _percentage;
    //     appreciation[_tomemberaddress] += _percentage;
    //     totalappreciation += _percentage;
    // }

 
    //=============================================================
    //                      Holon Merge and Fork Functions
    //=============================================================
    // these function will be used by the holon lead to mantain the holon members


    // function joinHolon(address _memberaddress, string memory _membername)
    //     public
    // {
    //     require(isMember[_memberaddress] == false, "Member was already added");
    //     require(toAddress[_membername] == address(0), "Name is already taken");
    //     _members.push(address(uint160(_memberaddress)));
    //     toAddress[_membername] = _memberaddress;
    //     toName[_memberaddress] = _membername;
    //     isContributor[_memberaddress] = true;

    //     emit Joined(_memberaddress, name);
    // }

    // This function should be called to respect the holonic peer production license.
    function forkHolon(string memory _holonname)
         public
    {
         //Holon newholon = Holon(address(uint160(factory.newHolon(_holonname))));
         //newholon.addMember(address(uint160(address(this))),"Initiators"); //Link back to origin
         //this.joinHolon(address(newholon),_holonname); // Link to fork
    }

    //=============================================================
    //                      Getters & Setters
    //=============================================================
    // these functions will be used to set and retrieve information about the holon
 
    /// @dev Sets the hash of the latest IPFS manifest for the holon
    /// @notice Only the holon lead can change this!
    /// @param _IPFSHash The hash of the IPFS manifest

    function setManifest(string memory _IPFSHash)
        public
    {
        require (msg.sender == lead,"Only lead can change the name");
        IPFSManifest = _IPFSHash;
    }

    /// @dev Internal function for transferring ether
    /// @param _dst The address of the receiver holon or member
    /// @param _amount  The amount of the ether to transfer

    function _transfer(address _dst, uint256 _amount)
        internal
    {
        (bool success, ) = _dst.call.value(_amount)("");
        require(success, "Transfer failed");
        
    }
}