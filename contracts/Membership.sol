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


import "../node_modules/openzeppelin-solidity/contracts/access/Ownable.sol";
import "../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./IHolonFactory.sol";

contract Membership is Ownable {
    using SafeMath for uint256;

    IHolonFactory factory;                          //Stores the factory of this holon


    bool passthecrown;

    address payable[] internal _members;
    address payable[] internal _contributors;

    mapping (address => bool) public isMember;      //returns true if an address is a member;
    mapping (address => bool) public isContributor; //returns true if an address is a contributor;
    // mapping (string => address) public toAddress;   //maps names to addresses
    // mapping (address => string) public toName;      //maps addresses to names
   
    //======================== Structures for tracking appreciation
    uint256 public totalappreciation;               // max amount of appreciation in this holon
    mapping (address => uint256) public appreciation; //appreciaton received by a member
    mapping (address => uint8) public remainingappreciation; //appreciation left to give (max=100)

    //======================== Events
    event AddedMember (address member, string name);
    event RemovedMember (address member, string name);

    constructor( address _holonfactory)
        public
    {
       totalappreciation = 0;
       passthecrown = false;
       factory = IHolonFactory (_holonfactory);
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
        public
    {
        require (isMember[msg.sender], "Sender is not a Holon member"); // validate sender is a Holon member
        require (isMember[_memberaddress], "Reciever is not a Holon member"); // validate receiver is a Holon member
        require (_memberaddress != msg.sender, "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.
        require (remainingappreciation[msg.sender] >= _percentage, "Not enough appreciation remaining");
        remainingappreciation[msg.sender] -= _percentage;
        appreciation[_memberaddress] += _percentage;
        totalappreciation += _percentage;
    }

   /// @dev Resets appreciation of the caller
    /// @notice This is the only way to change already assigned appreciation
    function resetAppreciation()
        public
        onlyOwner
    {
        totalappreciation = 0;
         for (uint256 i = 0; i < _members.length; i++) {
             address _memberaddress = _members[i];
             remainingappreciation[_memberaddress] = 100;
             appreciation[_memberaddress] = 0;
         }
         if (passthecrown)
            transferOwnership( _members[block.number % _members.length]);
    }

       //=============================================================
    //                      Member Management Functions
    //=============================================================
    // these function will be used by the holon lead to mantain the holon members

    function addMember(address payable _memberaddress, string memory _membername)
        public
    {   
        require(isMember[_memberaddress] == false, "Member already added");
        require((isMember[msg.sender] == true || this.owner() == msg.sender ), "Request submitted by a non-member address");
        //require(getAddress(_membername) == address(0), "Name is already taken");
        _members.push(_memberaddress);
        factory.changeName(_memberaddress,_membername);
        // toAddress[_membername] = _memberaddress;
        // toName[_memberaddress] = _membername;
        isMember[_memberaddress] = true;
        remainingappreciation[_memberaddress] = 100;
        if (passthecrown)
            transferOwnership(_memberaddress);
        //Yes, you heard that right. This is not a bug, it is called "Passing the crown".
        //Every new member becomes the owner, and he is going to be the only one allowed to bring in new members, and so on.
        //Make sure you don't add members you don't trust.

        emit AddedMember(_memberaddress, _membername);
    }
    
    function removeMember(address payable _memberaddress)
        public
        onlyOwner
    {
        for (uint256 i = 0; i < _members.length; i++) {
            if (_members[i] == _memberaddress) {
               _members[i] = _members[_members.length]; //swap position with last member
               break;
            }
        }

        _members.pop(); // remove last member
        isMember[_memberaddress] = false;
        isContributor[_memberaddress] = false;
        // toAddress[toName[_memberaddress]] = address(0);

        emit RemovedMember(_memberaddress,getMemberName(_memberaddress));
    }


    function upgradeToMember(address _memberaddress)
        public
        onlyOwner
    {
        isContributor[_memberaddress] = false;
        isMember[_memberaddress] = true;
    }

    function passTheCrown()
        public
        onlyOwner
    {
        passthecrown = true;
    }

    function getHolonSize()
        public
        view
        returns (uint256)
    {
        return _members.length;
    }

    function changeName(string memory _name) public onlyOwner{
        factory.changeName(address(this), _name);
    }

    function changeMemberName(address _memberaddress, string memory _name) public {
        require (isMember[_memberaddress]);
        factory.changeName(_memberaddress, _name);
    }

    function getName() public view returns (string memory){
        return factory.getName(address(this));
    }

    function getMemberName(address _memberaddress) public view returns (string memory){
        return factory.getName(_memberaddress);
    }

    /// @dev Retrieves the index of holon members
    /// @notice contributors are included in this list
    /// @return list with themembers and contributors of the holon

    function listMembers()
        external
        view
        returns (address payable[] memory)
    {
        return _members;
    }



}