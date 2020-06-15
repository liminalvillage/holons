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
import "../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./IHolonFactory.sol";

contract Holon is Ownable {
    using SafeMath for uint256;

    IHolonFactory factory;                          //Stores the factory of this holon

     //======================== Public holon variables
    string public name;                             //The name of the holon
    string public version = "0.1";                  //Version of the holon contract
    string public IPFSManifest;                     //IPFS Hash for the JSON containing holon manifest
    address public creator;                         //Link to the holonic parent
    bool public updated;                            //Bool representing if appreciation was dished but not updated
    bool public passthecrown;                       //Bool representing if passing the crown was enabled

    //======================== Indexing Stuctures
    address payable[] internal _members;            //structure containing the addresses of the members;
   
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
    event HolonRewarded (string name, string token, uint256 amount);
    event MemberRewarded (address member,string token, uint256 amount);
    event Appreciated (address memberfrom, address memberto, uint256 amount);
    event Joined (address _memberaddress, string _membername);
    event dishedReset ();
    
    /// @notice Constructor to create an holon
    /// @param _holonfactory The address of the HolonFactory contract that
    ///  created the Holon contract, the factory needs to be deployed first

    constructor( address _holonfactory)
        public
    {
       totalappreciation = 0;
       passthecrown = false;
       updated = false;
       factory = IHolonFactory (_holonfactory);
    }

    //=============================================================
    //                      Reward Functions
    //=============================================================
    //these function will be called when a payment is sent to the holon

    receive() 
        external 
        payable 
    {
        reward();
    }
   
    fallback()
        external
        payable
    {
        reward();
    }

    /// @dev Splits the ether sent to the holon according to the appreciation
    /// @notice If appreciation is not shared, it splits it equally across each member
    
    function reward()
        payable
        public
    {
        uint256 unitReward;

        if (totalappreciation > 0 ) // if appreciation was shared
            unitReward = msg.value.div(totalappreciation);
        else //if no appreciation was shared, blanket approach
            unitReward = msg.value.div(_members.length);

        for (uint256 i = 0; i < _members.length; i++) {
            uint256  amount;
            if (totalappreciation > 0 ) // if appreciation was shared
                amount = appreciation[_members[i]].mul(unitReward); //multiply given appreciation with unit reward
            else
                amount = unitReward; //else use blanket unit reward value.

            if (amount > 0){
                _transfer(_members[i], amount);
                MemberRewarded(_members[i], "ETHER", amount);
            }
        }
        emit HolonRewarded(name, "ETHER", msg.value);
    }


    /// @dev Splits the ERC20 token amount sent to the holon according to the appreciation
    /// @notice If appreciation is not shared, it splits it equally across each member (calling BlanketReward)
    function tokenReward(address _tokenaddress, uint256 _tokenamount)
        public
    {
        uint256 unitReward;
        //Load ERC20 token
        IERC20 token = IERC20(_tokenaddress);
        require (token.balanceOf(address(this)) >= _tokenamount, "Not enough tokens in the contract");
       
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

            if (amount > 1 ){
                    token.transfer(_members[i],amount);
                    if (factory.isHolon(_members[i]))  //is holon
                    { 
                        Holon holon = Holon(_members[i]);          //load holon
                        holon.tokenReward(_tokenaddress, amount);  //call reward function 
                    }
                    
                    //   (bool success,) = _members[i].delegatecall(
                    //     abi.encodeWithSignature("tokenReward(address,uint256)", _tokenaddress, amount)
                    // );
                MemberRewarded(_members[i], "ERC20", amount);
            }
        }
        emit HolonRewarded(name, "ERC20", _tokenamount);
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

    
    /// @dev Gives a percentage of appreciation to a specific member on behalf of a specific holon
    /// @notice Only the sending holon lead can call this function
    /// @notice A member cannot send appreciation to himself
    /// @notice Sender should have enough appreciation left to give
    /// @param _fromholonaddress The address of the sending holon
    /// @param _tomemberaddress The address of the receiving member
    /// @param _percentage The amount of the appreciation to give in percentage.

    function appreciateAsHolon(address payable _fromholonaddress, address _tomemberaddress, uint8 _percentage)
        public
    {
        require (isMember[_fromholonaddress], "Sender is not a Holon member"); // validate sender is a Holon member
        require (isMember[_tomemberaddress], "Receiver is not a Holon member"); // validate receiver is a Holon member
        require (_tomemberaddress != _fromholonaddress, "Sender cannot appreciate himself.. that's selfish"); // sender can't vote for himself.
        require (remainingappreciation[_fromholonaddress] >= _percentage, "Not enough appreciation remaining");
        require (Holon(_fromholonaddress).owner() == msg.sender, "Only the Holon Lead can send appreciation on behalf of his Holon!");

        remainingappreciation[_fromholonaddress] -= _percentage;
        appreciation[_tomemberaddress] += _percentage;
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

        emit AddedMember(_memberaddress, name);
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

    ///@dev Retrieves the address of the factory that created this Holon.
    ///@return The address of the factory
    
    function getFactory() 
        public 
        view 
        returns (address)
    {
        return address(factory);
    } 

    /// @dev Retrieves the size of the holon in terms of members
    /// @notice contributors are included in this number
    /// @return number of members and contributors in the holon

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

    /// @dev Sets the hash of the latest IPFS manifest for the holon
    /// @notice Only the holon lead can change this!
    /// @param _IPFSHash The hash of the IPFS manifest

    function setManifest(string memory _IPFSHash)
        public
        onlyOwner
    {
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