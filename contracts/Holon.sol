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
import "./Membrane.sol";

contract Holon is Membrane{
    using SafeMath for uint256;

     //======================== Public holon variables
    string public name;                             //The name of the holon
    string public version = "0.1";                  //Version of the holon contract
    string public IPFSManifest;                     //IPFS Hash for the JSON containing holon manifest
    address public creator;                         //Link to the holonic parent

    //======================== Events
    event HolonRewarded (address holon, string token, uint256 amount);
    event MemberRewarded (address member,string token, uint256 amount);

    /// @notice Constructor to create an holon
    ///  created the Holon contract, the factory needs to be deployed first

    constructor (address _creator, string  memory _name)
        public
    {
        name = _name;
        creator = _creator;
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
            //Load ERC20 token information
            token = IERC20(_tokenaddress);
            require (token.balanceOf(address(this)) >= _tokenamount, "Not enough tokens in the contract");
        }
        
        uint256  amount;

        for (uint256 i = 0; i < _members.length; i++) {
            if (totalappreciation > 0 ) // if any appreciation was shared
                amount = appreciation[_members[i]].mul( _tokenamount.div(totalappreciation)); //multiply given appreciation with unit reward
            else
                amount = _tokenamount.div(_members.length); //else use blanket unit reward value.

            if (amount > 0 ){
                if (etherreward){
                    (bool success, ) = _members[i].call.value(amount)("");
                    require(success, "Transfer failed");
                }
                else {
                    token.transfer(_members[i],amount);
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
 
    //=============================================================
    //                      Holon Merge and Fork Functions
    //=============================================================
    // these function will be used by the holon lead to mantain the holon members
    function newHolon(string calldata _name) external returns (address){
        (bool success,) = creator.call(
                    abi.encodeWithSignature("newHolon(string)", _name)
                    );
        require (success, "Holon creation failed");
    }

    // function joinHolon(address _memberaddress, string memory _membername)
    //     public
    // {
    //     require(isMember[_memberaddress] == false, "Member was already added");
    //     require(toAddress[_membername] == address(0), "Name is already taken");
    //     _members.push(address(uint160(_memberaddress)));
    //     toAddress[_membername] = _memberaddress;
    //     toName[_memberaddress] = _membername;
    //     //isContributor[_memberaddress] = true;

    //     //emit Joined(_memberaddress, name);
    // }

    //This function should be called to respect the holonic peer production license.
    // function spork(string memory _holonname){
    //    Holon newholon =fork("newname");
    //    newholon.spoon(address(this))
    //}

    //This function should be called to respect the holonic peer production license.
    // function fork(string memory _holonname)
    //      public
    // {
    //      Holon newholon = Holon(factory.newHolon(_holonname));
    //      newholon.addMember(address(this),"Initiator"); //Link back to origin
    //      this.joinHolon(address(newholon),_holonname); // Link to fork
    // }

    //=============================================================
    //                      Getters & Setters
    //=============================================================
    // these functions will be used to set and retrieve information about the holon
 
    /// @dev Sets the hash of the latest IPFS manifest for the holon
    /// @notice Only the holon lead can change this!
    /// @param _IPFSHash The hash of the IPFS manifest

    function setManifest(string calldata _IPFSHash)
        external
    {
        require (msg.sender == lead,"Only lead can set the manifest");
        IPFSManifest = _IPFSHash;
    }
}