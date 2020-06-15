pragma solidity ^0.6;

import "./Holon.sol";
import "./Membership.sol";

/* ---------------------------------------------------
 * This contract handles Holon creation, tracking and listing
 * The Holon initiatior is the Holon lead (owner) and he is able to add and remove members
 * from within the Holon contract
 *
 * ----------------------------------------------------
 */
contract HolonFactory is Membership{

    event ChangedName (string from, string to);

    mapping (address => bool) private isAHolon;
    mapping (address => bool) private isAMember;
    mapping (string => address) public toAddress;
    mapping (address => string) public toName;
    mapping (address => address[]) public holons;

    address[] internal _holons;

    uint256 public nholons;

    event NewHolon(string name, address addr);

    constructor() 
    public
    {
        nholons = 0;
    }

   function newHolon(string memory name) public returns (address holon)
    {
        if (toAddress[name] > address(0x0)) return toAddress[name];

        nholons += 1;
        Holon newholon = new Holon(address(this));
        newholon.transferOwnership(msg.sender);
        address addr = address(newholon);
        _holons.push(addr);

        holons[msg.sender].push(addr);
        toAddress[name] = addr;
        toName[addr] = name;
        isAHolon[addr] = true;

        emit NewHolon(name, addr);

        return addr;
    }


function stringsEqual(string storage _a, string memory _b)
        internal
        view
        returns (bool)
    {
        bytes storage a = bytes(_a);
        bytes memory b = bytes(_b);
        if (a.length != b.length)
            return false; // @todo unroll this loop
        for (uint i = 0; i < a.length; i ++)
        if (a[i] != b[i])
            return false;
        return true;
}

    /// @dev Changes the name of the Holon
    /// @notice only the holon lead (owner) can call this function
    /// @param _address The address of the person or holon
    /// @param _name The new name of the person or holon
    
    function changeName(address _address, string memory _name)
        public
    {
        // require((_address == msg.sender || _address == tx.origin ||  stringsEqual (toName[_address], "")) ,
        //     "Request not sent from member or holon");
        require (isHolon(msg.sender) ||_address == msg.sender || _address == tx.origin, "Name change request not sent from holon nor owner");
        toName[_address] = "";
        toAddress[_name] = _address;
        emit ChangedName(toName[_address], _name);
        toName[_address] = _name;
    }

    function isHolon(address _address) public view returns(bool){
        return isAHolon[_address];
    }

    function isMember(address _address) public view returns(bool){
        return isAMember[_address];
    }

    function getName(address _address) public view returns( string memory){
        return toName[_address];
    }

    function listHolons()
        external
        view
        returns (address[] memory)
    {
        return _holons;
    }

    function listHolonsOf(address owner)
        public
        view
        returns (address[] memory)
    {
        return holons[owner];
    }

}
