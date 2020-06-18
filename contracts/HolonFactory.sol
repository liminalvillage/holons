pragma solidity ^0.6;

import "./Holon.sol";
import "./Membrane.sol";

/* ---------------------------------------------------
 * This contract handles Holon creation, tracking and listing
 * The Holon initiatior is the Holon lead (owner) and he is able to add and remove members
 * from within the Holon contract
 *
 * ----------------------------------------------------
 */
contract HolonFactory is Membrane{

    event NewHolon(string name, address addr);

    constructor() 
    public
    {
    }

   function newHolon(string memory name) public returns (address holon)
    {
        if (toAddress[name] > address(0x0)) //An holon with the same name already exists
            return toAddress[name];

        Holon newholon = new Holon(address(this));
        address addr = address(newholon);
        addMember(addr, name);

        emit NewHolon(name, addr);

        return addr;
    }
}
