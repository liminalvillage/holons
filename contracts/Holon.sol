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
import "../node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./IHolonFactory.sol";
import "./Membrane.sol";

contract Holon is Membrane{
    using SafeMath for uint256;

     //======================== Public holon variables
    string public name;                      //The name of the holon
    string public version;                   //Version of the holon contract
    string public flavor;                    //Type of the holon
    address public creator;                  //Link to the holonic parent

    //======================== Events
    event HolonRewarded (address holon, string token, uint256 amount);
    event MemberRewarded (address member,string token, uint256 amount);

    /// @notice Constructor to create an holon
    ///  created the Holon contract, the factory needs to be deployed first


    // /// @dev Splits the ERC20 token amount sent to the holon according to the appreciation
    // /// @notice If appreciation is not shared, it splits it equally across each member (calling BlanketReward)
    //  function reward(address _tokenaddress, uint256 _tokenamount)
    //     public
    //     payable
    //     override
    // {
    //     bool etherreward;
    //     IERC20 token;

    //     if (msg.value  > 0 && _tokenaddress == address(0)) {
    //         _tokenamount = msg.value;
    //         etherreward = true;
    //     }
    //      else {
    //         //Load ERC20 token information
    //         token = IERC20(_tokenaddress);
    //         require (token.balanceOf(address(this)) >= _tokenamount, "Not enough tokens in the contract");
    //     }
        
    //     uint256  amount;

    //     for (uint256 i = 0; i < _members.length; i++) {
    //         if (totalappreciation > 0 ) // if any appreciation was shared
    //             amount = appreciation[_members[i]].mul( _tokenamount.div(totalappreciation)); //multiply given appreciation with unit reward
    //         else
    //             amount = _tokenamount.div(_members.length); //else use blanket unit reward value.

    //         if (amount > 0 ){
    //             if (etherreward){
    //                 (bool success, ) = _members[i].call{value: amount}("");
    //                 require(success, "Transfer failed");
    //             }
    //             else {
    //                 token.transfer(_members[i],amount);
    //                 (bool success,) = _members[i].call(
    //                 abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
    //                 );
    //                 require(success, "Unable to call the reward function" );
    //             }
    //             MemberRewarded(_members[i], "ERC20", amount);
    //         }
    //     }
    //     emit HolonRewarded(address(this), "ERC20", _tokenamount);
    // }

    //=============================================================
    //                      Holon Creation, Fork and Merge Functions
    //=============================================================
    // these function will be used by the holon lead to mantain the holon members
    function newHolon(string calldata _flavor, string calldata _name, uint _parameter) external returns (address){
        IHolonFactory factory = IHolonFactory(creator);
        return factory.newHolon(_flavor, _name, _parameter);
        
        // (bool success, bytes memory data ) = creator.call(
        //             abi.encodeWithSignature("newHolon(string, uint)", _name, _parameter)
        //             );
        // emit Response(success, data);
        // require (success, "Holon creation failed");
    }

    // function joinHolon(address _memberaddress, string memory _membername)
    //     public
    // {
    //     require(isMember[_memberaddress] == false, "Member was already added");
    //     require(toAddress[_membername] == address(0), "Name is already taken");
    //     _members.push(address(uint160(_memberaddress)));
    //     toAddress[_membername] = _memberaddress;
    //     toName[_memberaddress] = _membername;
    //     //isContributor[_memberaddress] = true;

    //     //emit Joined(_memberaddress, name);
    // }

    //This function should be called to respect the holonic peer production license.
    // function spork(string memory _holonname){
    //    Holon newholon =fork("newname");
    //    newholon.spoon(address(this))
    //}

    //This function should be called to respect the holonic peer production license.
    // function fork(string memory _holonname)
    //      public
    // {
    //      Holon newholon = Holon(factory.newHolon(_holonname));
    //      newholon.addMember(address(this),"Initiator"); //Link back to origin
    //      this.joinHolon(address(newholon),_holonname); // Link to fork
    // }

      receive() 
        external 
        payable 
    {
        reward(address(0),msg.value);
    }
   
    fallback()
        external
        payable
    {
        reward(address(0),msg.value);
    }


    function reward(address _tokenaddress, uint256 _tokenamount)
        public
        payable
        virtual
    {
        require (_members.length > 0, "No members to reward");
        bool etherreward = false;
        IERC20 token;

        if (msg.value  > 0 && _tokenaddress == address(0)) {
            _tokenamount = msg.value;
            etherreward = true;
        }
         else {
            //Load ERC20 token information
            token = IERC20(_tokenaddress);
            require (token.balanceOf(address(this)) >= _tokenamount, "Not enough tokens in the contract");
        }
        
        uint256 amount = _tokenamount.div(_members.length); // use blanket unit reward value.

        for (uint256 i = 0; i < _members.length; i++) {
            if (amount > 0 ){
                if (etherreward){
                    (bool success, ) = _members[i].call{value: amount}("");
                    require(success, "Transfer failed");
                }
                else {
                    token.transfer(_members[i],amount);
                    (bool success,) = _members[i].call(
                    abi.encodeWithSignature("reward(address,uint256)", _tokenaddress, amount)
                    );
                    require(success, "Unable to call the reward function" );
                }
                MemberRewarded(_members[i],etherreward? "ETHER":"ERC20", amount);
            }
        }
        emit HolonRewarded(address(this), etherreward? "ETHER":"ERC20", _tokenamount);
    }
}