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


contract Holons {

    mapping (address => address[]) private holons;
    mapping (string => address) public toAddress;   //NOTE: Remove on deploy

    event NewHolon (string name, address addr);

    function newHolon(string memory _flavor, string memory _name, uint _parameter) public returns (address) {
        require(flavors[_flavor] != address(0), "Flavor with this name does not exist");
        address flavorAddress = flavors[_flavor];

        (bool success, bytes memory result) = flavorAddress.delegatecall(
            abi.encodeWithSignature("newHolon(string,uint256)", _name, _parameter)
        );
        
        require(success, "Holon creation failed");
        address holonAddress = abi.decode(result, (address));
        emit NewHolon( _name, holonAddress);
        
        return holonAddress;
    }

    mapping (string => address) private flavors;
    string[] public knownflavors;

    event NewFlavor(address indexed flavor, string name);
    
    function newFlavor(string calldata _flavorname, address _flavoraddress) public {
        require(flavors[_flavorname] == address(0), "Flavor with this name already exists");
        flavors[_flavorname] = _flavoraddress;
        knownflavors.push(_flavorname);
        emit NewFlavor( _flavoraddress,  _flavorname);
    }
    

    function getFlavorAddress(string memory _name) public view returns (address) {
        require(flavors[_name] != address(0), "Flavor with this name does not exist");
        return flavors[_name];
    }

    // returns the list of flavors
    function listFlavors() public view returns (string [] memory ) {
        return knownflavors;
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
}
