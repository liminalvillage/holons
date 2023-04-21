var fs = require('fs');
var files = fs.readdirSync('./build/contracts');
for (var i in files) {

	var f = require(__dirname + '/build/contracts/' + files[i]);
	console.log("processing  " +  f.contractName); 
	var  obj= f.networks;
        var address = '';
        if (Object.keys(obj) == 0 ) { 
	 console.log('WARNING: '+ f.contractName +' is not deployed');
	}
	else {
       	 address = obj[Object.keys(obj)[0]].address;
	}
	console.log("Address: " + address);
	var data = {
		//bytecode: f.bytecode,
		abi: f.abi,
		address: address
	};

	console.log(data);

	var outputFileName = __dirname + '/frontend/src/data/' + f.contractName + ".json";
	console.log('saving to', outputFileName);
	fs.writeFile(outputFileName, JSON.stringify(data), 'utf8',function(){});
}

