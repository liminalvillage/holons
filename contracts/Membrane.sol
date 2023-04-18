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

contract Membrane {
    using SafeMath for uint256;


    address payable[] internal _members;
    address[] internal _parents;
    address owner;
    string public manifest;                  //IPFS Hash for the JSON containing the manifest of this membrane
  
    mapping (address => bool) public isMember;      //returns true if an address is a member;
    mapping (string => address) public toAddress;   //maps names to addresses
    mapping (address => string) public toName;      //maps addresses to names
   
    event AddedMember (address member, string name);
    event RemovedMember (address member, string name);
    event ChangedName(string namefrom, string nameto);

    constructor ()
    {
        owner = tx.origin;
        
    }


    // ====================================================
    //                      Member Management Functions
    //=============================================================
    // these function will be used by the holon lead to mantain the holon members

    function addMember(address  _memberaddress, string memory _membername) virtual
        public
    {
        require((isMember[msg.sender] == true || owner == msg.sender), "Request submitted by a non-member address");
        require(isMember[_memberaddress] == false, "Member already added");
        require(toAddress[_membername] == address(0), "Name is already taken");
        _members.push(payable(_memberaddress));
        toName[_memberaddress] = _membername;
        toAddress[_membername] = _memberaddress;
        isMember[_memberaddress] = true;
        
        //Membrane(_memberaddress).addParent(address(this));
        (bool success,) = _memberaddress.call(
                    abi.encodeWithSignature("addParent(address)", address(this))
                    );
        require (success, "Failed to create parent");
        
       
        emit AddedMember(_memberaddress, _membername);
    }

    function addParent(address  _parentaddress)
        public
    {
        _parents.push(_parentaddress);
    }


    function removeMember(address _memberaddress)
        external
    {
        require(owner == msg.sender, "Request submitted by a non-member address" );
        for (uint256 i = 0; i < _members.length; i++) {
            if (_members[i] == _memberaddress) {
               _members[i] = _members[_members.length]; //swap position with last member
               break;
            }
        }

        _members.pop(); // remove last member
        isMember[_memberaddress] = false;

        emit RemovedMember(_memberaddress,toName[_memberaddress]);

        toAddress[toName[_memberaddress]] = address(0);
        toName[_memberaddress] = "";
   
    }
    
     /// @dev Changes the name of the member
    /// @notice only the lead can call this function
    /// @param _address The address of the member
    /// @param _name The new name of the member

    function changeName(address _address, string memory _name)
        public
    {
        require (_address == msg.sender ||
                msg.sender == owner ||
                _address == tx.origin ,
                "Name change request not sent from member nor owner");
        toAddress[_name] = _address;
        emit ChangedName(toName[_address], _name);
        toName[_address] = _name;
    }
 
    
    /// @dev Retrieves the index of  members in the membrane
    /// @return list of the address of the members

    function listMembers()
        external
        view
        returns (address payable[] memory)
    {
        return _members;
    }

    /// @dev Retrieves the list of parents of the membrane
    /// @return the address of the parents of the membrane

    function listParents()
        external
        view
        returns (address[] memory)
    {
        return _parents;
    }

    /// @dev Retrieves the size of the membrane
    /// @return number of members in the membrane

    function getSize()
        external
        view
        returns (uint256)
    {
        return _members.length; //+ _contributors.length;
    }

        //=============================================================
    //                      Reward Functions
    //=============================================================
    //these function will be called when a payment is sent to the holon


    /// @dev Sets the hash of the latest IPFS manifest for this membrane
    /// @notice Only the holon lead can change this!
    /// @param _IPFSHash The hash of the IPFS manifest

    function setManifest(string calldata _IPFSHash)
        external
    {
        require (msg.sender == owner, "Only owner can set the manifest");
        manifest = _IPFSHash;
    }
}