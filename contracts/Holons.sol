// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8;

contract Holons {

    mapping (address => address[]) private holons;
    mapping (string => address) public toAddress;   //NOTE: Remove on deploy
    mapping (string => address) private factories;


    event NewHolon (string name, address addr);
    event NewFactory(address indexed factory, string name);
    
    function newFactory(string calldata _name, address _factoryaddress) public {
        require(factories[_name] == address(0), "Factory with this name already exists");
        factories[_name] = _factoryaddress;
        emit NewFactory( _factoryaddress,  _name);
    }
    
    function newHolon(string memory _flavor, string memory _name, uint _parameter) public returns (address) {
        require(factories[_flavor] != address(0), "Factory with this name does not exist");
        address factoryAddress = factories[_flavor];

        (bool success, bytes memory result) = factoryAddress.delegatecall(
            abi.encodeWithSignature("newHolon(string,uint256)", _name, _parameter)
        );
        
        require(success, "Holon creation failed");
        address holonAddress = abi.decode(result, (address));
        emit NewHolon( _name, holonAddress);
        
        return holonAddress;
    }
    
    function getFactory(string memory _name) public view returns (address) {
        require(factories[_name] != address(0), "Factory with this name does not exist");
        return factories[_name];
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

//     event NewHolon (string name, address addr);

   
//     address[] public versions;
//     uint public latestversion;

//     mapping (address => address[]) private holons;
//     mapping (string => address) public toAddress;   //TODO: Remove on deploy
 
//     constructor ()
//     {
//         latestversion = 0;
//         versions.push(address(new HolonFactory()));
//     }


//       /// @dev Creates an new holon and adds it to the global and personal list
//     /// @param _name The name of the holon.
//     /// @return Address of the new holon

//    function newHolon(string calldata _name, uint _parameter) public returns (address)
//     {
//         IHolonFactory factory = IHolonFactory(versions[latestversion]);
//         return factory.newHolon(_name, _parameter);

//         // (bool success, bytes memory result) = versions[latestversion].delegatecall(abi.encodeWithSignature("newHolon(string,uint)", _name,_parameter));
//         // //require (success, "delegate call failed");
//         // return abi.decode(result, (address));
//     }

//     /// @dev Creates an new holon and adds it to the global and personal list
//     /// @param _name The name of the holon.
//     /// @return Address of the new holon

// //    function newHolon(uint _version, string memory _name, uint _parameter) public returns (address)
// //     {
// //         (bool success, bytes memory result) = versions[_version].delegatecall(abi.encodeWithSignature("newHolon(string,uint)", _name,_parameter));
// //         require (success, "delegate call failed");
// //         return abi.decode(result, (address));
// //     }
}
