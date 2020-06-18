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

contract Membrane {
    using SafeMath for uint256;

    address lead;
    bool passthecrown;
    address[] internal _members;
    address[] internal _parents;
    //mapping (address => address[]) public membersOf;
  
    mapping (address => bool) public isMember;      //returns true if an address is a member;
    mapping (string => address) public toAddress;   //maps names to addresses
    mapping (address => string) public toName;      //maps addresses to names
   
    //======================== Structures for tracking appreciation
    uint256 public totalappreciation;               // max amount of appreciation in this holon
    mapping (address => uint256) public appreciation; //appreciaton received by a member
    mapping (address => uint8) public remainingappreciation; //appreciation left to give (max=100)

    //======================== Events
    event AddedMember (address member, string name);
    event RemovedMember (address member, string name);
    event ChangedName(string namefrom, string nameto);

    constructor ()
        public
    {
        lead = tx.origin;
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
        require (msg.sender == lead,"Only lead can perform this action");
        Membrane(_parent).appreciate(_sibling,_percentage);
    }


   /// @dev Resets appreciation of the caller
    /// @notice This is the only way to change already assigned appreciation
    function resetAppreciation()
        external
    {
        require(msg.sender == lead, "Only the lead can reset appreciation");
        totalappreciation = 0;
         for (uint256 i = 0; i < _members.length; i++) {
             address _memberaddress = _members[i];
             remainingappreciation[_memberaddress] = 100;
             appreciation[_memberaddress] = 0;
         }
        //  if (passthecrown){
        //      if (_members[block.number % _members.length] != lead)
        //         lead = _members[block.number % _members.length];  //elects random lead.
        //     else
        //         lead = _members[(block.number + 1) % _members.length]; //avoids reelecting the same lead;
        //  }
    }

    //=============================================================
    //                      Member Management Functions
    //=============================================================
    // these function will be used by the holon lead to mantain the holon members

    function addMember(address  _memberaddress, string memory _membername)
        public
    {
        require((isMember[msg.sender] == true || lead == msg.sender ), "Request submitted by a non-member address");
        require(isMember[_memberaddress] == false, "Member already added");
        require(toAddress[_membername] == address(0), "Name is already taken");
        _members.push(_memberaddress);
        toName[_memberaddress] = _membername;
        toAddress[_membername] = _memberaddress;
        isMember[_memberaddress] = true;
        remainingappreciation[_memberaddress] = 100;
        //Membrane(_memberaddress).addParent(address(this));
        (bool success,) = _memberaddress.call(
                    abi.encodeWithSignature("addParent(address)", address(this))
                    );
        require (success, "Failed to create parent");
        
        if (passthecrown)
            lead = _memberaddress;
        //If "Passing the crown" is enabled.
        //Every new member becomes the owner, and he is going to be the only one allowed to bring in new members, and so on.
        //If you are using this pattern, make sure you don't add members you don't trust.
        
        emit AddedMember(_memberaddress, _membername);
    }
    

    function removeMember(address _memberaddress)
        external
    {
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
    
    function addParent(address  _parentaddress)
        public
    {
        _parents.push(_parentaddress);
    }

    function passTheCrown()
        external
    {
        require(msg.sender == lead, "Only the lead can set pass the crown");
        passthecrown = true;
    }

    /// @dev Retrieves the index of  members in the membrane
    /// @return list of the members 

    function listMembers()
        external
        view
        returns (address[] memory)
    {
        return _members;
    }

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
        public
        view
        returns (uint256)
    {
        return _members.length; //+ _contributors.length;
    }

    /// @dev Changes the name of the member
    /// @notice only the lead can call this function
    /// @param _address The address of the member
    /// @param _name The new name of the member

    function changeName(address _address, string memory _name)
        public
    {
        require (_address == msg.sender || msg.sender == lead || _address == tx.origin , "Name change request not sent from member nor owner");
        toAddress[_name] = _address;
        emit ChangedName(toName[_address], _name);
        toName[_address] = _name;
    }
}