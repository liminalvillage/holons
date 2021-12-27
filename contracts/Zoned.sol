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

contract Zoned is Membrane{
    using SafeMath for uint256;

     //======================== Public holon variables
    string public name;                             //The name of the holon
    string public version = "0.1";                  //Version of the holon contract
    string public IPFSManifest;                     //IPFS Hash for the JSON containing holon manifest
    address public creator;                         //Link to the holonic parent
    uint public nzones;
    mapping (uint => address[]) zonemembers;
    mapping (address => uint) zone;

    //======================== Events
    event HolonRewarded (address holon, string token, uint256 amount);
    event MemberRewarded (address member,string token, uint256 amount);

    /// @notice Constructor to create an holon
    ///  created the Holon contract, the factory needs to be deployed first

    constructor (address _creator, string  memory _name, uint _nzones)
        public
    {
        name = _name;
        creator = _creator;
        nzones = _nzones;
        zone[owner] = _nzones;
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
        for (uint256 z = 1;  z < nzones; z++) { //skip zone 0 as unassigned members
            amount = rewardFunction(z, amount).div(zonemembers[z].length); // divide reward equally for all members in the same zone
            for (uint256 i = 0; i < zonemembers[z].length; i++) {
        
        //     if (totalappreciation > 0 ) // if any appreciation was shared
        //         amount = appreciation[_members[i]].mul( _tokenamount.div(totalappreciation)); //multiply given appreciation with unit reward
        //     else
        //         amount = _tokenamount.div(_members.length); //else use blanket unit reward value.

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
                    // MemberRewarded(_members[i], "ERC20", amount); TODO
                }
            }
       // emit HolonRewarded(address(this), "ERC20", _tokenamount);TODO
        }   
    }
    
    function rewardFunction(uint _zone, uint _totalreward) private returns (uint zonereward)
    {

        return _totalreward / (2 ^ (_zone + 1));
    }

    function addToZone(address _memberaddress, uint _zone) public/// @notice Explain to an end user what this does
    /// @dev Explain to a developer any extra details
    /// @param Documents a parameter just like in doxygen (must be followed by parameter name)) private returns (uint zonereward)
    {
        require(zone[msg.sender] > _zone, "members in lower zones cannot promote to higher zones"); // ch
        // TODO Cooloff period for nominations or validation of nomination
       
       
        if (zone[_memberaddress] > 0) {//if member was already in a zone
             //search and remove member from current group
            // fetch correct zone members 
            uint previouszone = zone[_memberaddress];
            for (uint256 i = 0; i < zonemembers[previouszone].length; i++) {
                if (zonemembers[previouszone][i] == _memberaddress) {
                zonemembers[previouszone][i] = zonemembers[previouszone][zonemembers[previouszone].length]; //swap position with last member
                break;
                }
            }
            zonemembers[previouszone].pop(); // remove last member
        }
        
        zone[_memberaddress] = _zone;
        zonemembers[_zone].push(_memberaddress);
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
        require (msg.sender == owner,"Only lead can set the manifest");
        IPFSManifest = _IPFSHash;
    }
}