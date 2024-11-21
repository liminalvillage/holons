// SPDX-License-Identifier: MIT
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

import "./Membrane.sol"; //TODO import interface instead

contract Crown is Membrane{
    //======================== Structures for tracking appreciation
   
    address lead;
    bool passthecrown;

    constructor ()
    {
        lead = tx.origin;
    }

    function enablePassTheCrown()
        external
    {
        require(msg.sender == lead, "Only the lead can enable 'pass the crown'");
        passthecrown = true;
    }

    /// @dev Makes sure the crown is not passed to the same person
    /// @notice this function is internal

    function passTheCrown() 
        internal 
    {
        if (passthecrown){ // checks if the feature is enabled
             if (_members[block.number % _members.length] != lead)
                lead = _members[block.number % _members.length];  //elects random lead.
            else
                lead = _members[(block.number + 1) % _members.length]; //avoids reelecting the same lead;
        }
    }

    // function addMember(address  _memberaddress, string memory _membername) public override{
            
    //          if (passthecrown)
    //             lead = _memberaddress;
    //         //If "Passing the crown" is enabled.
    //         //Every new member becomes the owner, and he is going to be the only one allowed to bring in new members, and so on.
    //         //If you are using this pattern, make sure you don't add members you don't trust.
        
    // }
    // function removeMember() external override{
      
    //     passTheCrown();
    // }

}