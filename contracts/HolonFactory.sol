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

    //mapping (address => bool) private isAHolon;
    mapping (address => address[]) public holonsOf;

    address[] internal _holons;

    uint256 public nholons;

    event NewHolon(string name, address addr);

    constructor() Membership (address(this))
    public
    {
    }

   function newHolon(string memory name) public returns (address holon)
    {
          if (toAddress[name] > address(0x0)) return toAddress[name];

        nholons += 1;
        Holon newholon = new Holon(address(this));
        address addr = address(newholon);
        _holons.push(addr);

        holonsOf[msg.sender].push(addr);
        toAddress[name] = addr;
        toName[addr] = name;
        //isAHolon[addr] = true;

        emit NewHolon(name, addr);

        return addr;
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
        return holonsOf[owner];
    }

}
