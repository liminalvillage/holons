import HoloSphere from '../holosphere.js';

async function radiskExample() {
    console.log('HoloSphere Radisk Example');
    
    // Create HoloSphere instance with radisk enabled (default)
    const holoSphere = new HoloSphere('radisk-example');
    
    // Configure radisk with custom options
    holoSphere.configureRadisk({
        file: './my-radata', // Custom directory
        radisk: true,        // Enable radisk storage
        retry: 5,            // 5 retries for failed operations
        timeout: 10000       // 10 second timeout
    });
    
    // Get radisk statistics
    const stats = holoSphere.getRadiskStats();
    console.log('Radisk Stats:', stats);
    
    // Store some data - it will be persisted to disk
    const testData = {
        id: 'test-1',
        message: 'This data will be persisted to disk via radisk',
        timestamp: Date.now()
    };
    
    await holoSphere.put('test-holon', 'test-lens', testData);
    console.log('Data stored and persisted to disk');
    
    // Retrieve the data
    const retrieved = await holoSphere.get('test-holon', 'test-lens', 'test-1');
    console.log('Retrieved data:', retrieved);
    
    // Close the instance
    await holoSphere.close();
    console.log('HoloSphere instance closed');
}

// Run the example
radiskExample().catch(console.error); 