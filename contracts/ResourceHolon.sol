pragma solidity ^0.6;
pragma experimental ABIEncoderV2;


contract ResourceHolon
{
    enum Status {Requested, Claimed, Completed}

    enum Assets {Time, Energy, Transportation, Waste}

    struct Recipe {
        string name;
        address[] components;// which sub resources are needed (by address)
        uint[] componentRecipe; //tells which specific recipe to order in the components
        uint[] amounts; // tell how much we need (in resource units defined in the DAO )
        uint timesrequested; // this increments every request to compute the percentage of orders w.r.t. the rest;
        //string IPFSInfo;//Resource description and parameters following DAO-wide standard decided by prosumers
    }

    struct Request {
        address requester;
        uint recipeID;
        uint[] trueprice;
        uint amounts;
        string location; //(geohash)
        uint8 status;
        uint creation;
        //string IPFSInfo;
    }

    //Each dao contains information about its recipes)
     Recipe[]  public recipes;

    //Alternative: Agent based (every DAO IS a recipe)
    //mapping(int=>Resource[]) components;
    //mapping(int=>int[]) quantities;

    uint public nrecipes;
    uint public bestrecipe; // Selected by DAO prosumer signaling


    Request[] public requests;

    string public label;   // the name of this resource
    uint public id;        // unique identifier of the resource
    uint public nrequests; // Current overall demand of resource


    event NewRequest(string _label , uint recipeID, uint amount );
    event NewRecipe(string _label);

    constructor (string memory _label, uint _id) public
    {
        nrequests = 0;
        nrecipes = 0;
        bestrecipe = 0;
        label = _label;
        id = _id;
    }

    // The request function is called to make an order.
    // Assets used by the request should enter escrow agreement
    // The order is forwarded to all sub-resources,
    // The bestrecipe should be decided using token-curated registries
    //
    function request(uint _amount, string memory _location) public
    {
        requestRecipe(bestrecipe, _amount, _location);
    }

    // The
    // call for specific recipe
    function requestRecipe(uint _recipeID, uint _amount, string memory _location) public
    {
        uint[] memory trueprice = getTruePrice(_recipeID); //calculate the cost per unit
        Request memory order = Request (msg.sender, _recipeID,  trueprice, _amount, _location, 0 , now);
        nrequests += _amount;
        requests.push(order);

        if (nrecipes == 0 || _recipeID >= nrecipes ) return ; //Check validity of request

        //Order component resources
        for (uint i = 0; i<recipes[_recipeID].components.length; i++)
        {
            //if (recipes[_recipeID].components[i] == address(0x0)) return; //exit if no additional components are required

            uint ramount = recipes[_recipeID].amounts[i] * _amount; //Here we are multipling needed components with the requested amount
            uint rrecipe = recipes[_recipeID].componentRecipe[i];

            ResourceHolon r = ResourceHolon(address(uint160(recipes[_recipeID].components[i])));
            r.requestRecipe(rrecipe, ramount,_location);
        }

        //Notify listeners
        emit NewRequest(label,_recipeID,_amount);
    }

    function getRequestInfo(uint requestId ) public view returns (
      address requester,
      uint amounts,
      string memory location,
      uint status,
      uint creation
    ){
        
      Request storage order =  requests[ requestId ];
      requester = order.requester;
      amounts = order.amounts;
      location = order.location;
      status = order.status;
      creation = order.creation;

    }

    function getStatus(uint requestId) public view returns (uint status) {
      Request memory order = requests[requestId];
      status = order.status;
      return status;
    }

    //concludes delivery of the product or service.
    //Value should move from the user account to the entire value chain
    //Also reputation should be minted in all parties involved
    function confirm(uint requestId) public
    {
        Request storage order = requests[requestId];
        order.status = 2;
        //Transfer agreed amount from requester to supplier

        //exchange.addAssets(msg.sender,order.trueprice, order.amounts);
        //exchange.subtractAssets(order.requester,order.trueprice, order.amounts);
        //exchange.wallets[order.requester][id] -= order.amounts;
        //exchange.wallets[msg.sender][id] += order.amounts;

    }

    function getRecipes () view public returns (string[] memory) {
        string[] memory res = new string[](nrecipes);

        for (uint i = 0; i < nrecipes; i++) {
            res[i] = recipes[i].name;
        }

        return res;
    }

    // function getTruePrice(uint recipeID) view public returns (uint) {
    //     uint sum = 0;
    //     if ( nrecipes == 0 ) return 1; // exit rule, change for different assets;
    //     for (uint i = 0; i < recipes[recipeID].components.length; i++){
    //         sum+=recipes[recipeID].amounts[i]*ResourceHolon(recipes[recipeID].components[i]).getTruePrice(recipes[recipeID].componentRecipe[i]);
    //     }
    //     return sum;
    // }




    function getTruePrice(uint recipeID) view public returns (uint[] memory) {
       uint[] memory result = new uint[](12); // resource 0 is deiscarded
       if ( nrecipes == 0 )  {
           result[id]++;
           return result; // exit recursion on basic resources;
       }
        for (uint i = 0; i < recipes[recipeID].components.length; i++){
            ResourceHolon r = ResourceHolon(address(uint160(recipes[recipeID].components[i])));
            result = mulVectors(addVectors(result, r.getTruePrice(recipes[recipeID].componentRecipe[i])),recipes[recipeID].amounts[i]);
        }
        return result;
    }


     function  addVectors (uint[] memory lhs, uint[] memory rhs) pure public returns (uint[] memory)
    {
        uint[] memory v =  new uint[](lhs.length);
        for (uint i = 0; i < lhs.length; i++)
            v[i] = lhs[i] + rhs[i];
        return v;
    }

    function  mulVectors (uint[] memory lhs, uint scalar) pure  public returns (uint[] memory)
    {
        uint[] memory v = new uint[](lhs.length);
        for (uint i = 0; i < lhs.length; i++)
            v[i] = lhs[i] * scalar;
        return v;
    }

    function addRecipe(string memory name, address[] memory components, uint[] memory componentRecipe, uint[] memory quantities) public{
        recipes.push(Recipe(name, components, componentRecipe,quantities,0));
        nrecipes++;
        emit NewRecipe(name);
    }

   function getComponents(uint recipeID) view public returns (address[] memory ){
        return recipes[recipeID].components;
    }


    //This function is called by the people contributing. They will ask for a debt from all the sub-resources i
    //It mints one unfungible tokens where the contributions are recorded
    // function make(uint recipeID){
    //     //require good standing of sender ( positive reputation, no debts, track record, escrow)
    //     //
    //     msg.sender.transfer(recipeID.componentID)
    //     //mint output token
    // }
}
