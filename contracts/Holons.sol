pragma solidity ^0.6;
import "./IHolonFactory.sol";
import "./Holon.sol";


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

contract Holons {

    event NewHolon (string name, address addr);

   
    address[] public versions;
    uint public latestversion;

    mapping (address => address[]) private holons;
    mapping (string => address) public toAddress;   //TODO: Remove on deploy
 
    constructor ()
        public
    {
        latestversion = 0;
        Holon firstholon = new Holon(address(this), "template");
        versions.push(address(firstholon));
    }


      /// @dev Creates an new holon and adds it to the global and personal list
    /// @param _name The name of the holon.
    /// @return Address of the new holon

   function newHolon(string memory _name, uint _parameter) public returns (address)
    {
        (bool success, bytes memory result) = versions[0].delegatecall(abi.encodeWithSignature("newHolon(string,uint)", _name,_parameter));
        require (success, "delegate call failed");
        return abi.decode(result, (address));
    }

    /// @dev Creates an new holon and adds it to the global and personal list
    /// @param _name The name of the holon.
    /// @return Address of the new holon

   function newHolon(uint _version, string memory _name, uint _parameter) public returns (address)
    {
        (bool success, bytes memory result) = versions[_version].delegatecall(abi.encodeWithSignature("newHolon(string,uint)", _name,_parameter));
        require (success, "delegate call failed");
        return abi.decode(result, (address));
    }

    /// @dev Lists every holons ever created
    /// @return an array containing the address of every holon ever created.

    function listHolons() external view returns (address[] memory ){
        return holons[address(0)];
    }

    /// @dev Lists every holons created by a given address
    /// @param _address address;
    /// @return an array containing the address of every holon ever created.

    function listHolonsOf(address _address) external view returns (address[] memory){
        return holons[_address];
    }

    function addVersion(address versionaddress) public{
        //TODO: Check if community wants it before adding
        latestversion += 1;
        versions.push(versionaddress); 
    }

}
