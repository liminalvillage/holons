pragma solidity ^0.6;

import "../node_modules/openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
  
/**
* @title TestToken is a basic ERC20 Token
*/
contract TestToken is ERC20 {
    constructor (uint256 initialSupply) ERC20("Gold", "GLD") public {
        _mint(msg.sender, initialSupply);
    }
}