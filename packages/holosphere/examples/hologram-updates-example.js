// hologram-updates-example.js
// Example showing how to use the returned list of updated holograms from put()

import HoloSphere from '../holosphere.js';

async function exampleUsage() {
    const holosphere = new HoloSphere('example-app', false);
    
    try {
        // 1. Create some original data
        const originalData = { 
            id: 'product-123', 
            name: 'Widget', 
            price: 19.99,
            inventory: 100 
        };
        
        console.log('Step 1: Storing original data...');
        await holosphere.put('store', 'products', originalData);
        
        // 2. Create holograms in different locations (maybe for different displays/views)
        console.log('Step 2: Creating holograms...');
        const hologram1 = holosphere.createHologram('store', 'products', originalData);
        const hologram2 = holosphere.createHologram('store', 'products', originalData);
        
        await holosphere.put('storefront', 'display', { id: 'featured-product', soul: hologram1.soul });
        await holosphere.put('warehouse', 'inventory', { id: 'stock-item', soul: hologram2.soul });
        
        // Wait for the relay to propagate
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 3. Update the original data and get the list of updated holograms
        console.log('Step 3: Updating original data...');
        const updatedData = { 
            ...originalData, 
            price: 17.99,  // Price reduction!
            inventory: 95, // Some sold
            lastUpdated: Date.now()
        };
        
        const result = await holosphere.put('store', 'products', updatedData);
        
        console.log('PUT Result:', {
            success: result.success,
            pathInfo: {
                holon: result.pathHolon,
                lens: result.pathLens,
                key: result.pathKey
            },
            updatedHologramsCount: result.updatedHolograms.length
        });
        
        // 4. Process the updated holograms
        console.log('Step 4: Processing updated holograms...');
        if (result.updatedHolograms.length > 0) {
            console.log(`Updated ${result.updatedHolograms.length} holograms:`);
            
            for (const hologram of result.updatedHolograms) {
                console.log(`  - Hologram at ${hologram.holon}/${hologram.lens}/${hologram.key}`);
                console.log(`    Soul: ${hologram.soul}`);
                console.log(`    Updated at: ${new Date(hologram.timestamp).toISOString()}`);
                
                // Example post-processing: 
                // You could trigger UI updates, send notifications, update caches, etc.
                
                if (hologram.holon === 'storefront') {
                    console.log('    -> Triggering storefront display refresh');
                    // triggerStorefrontRefresh(hologram.key);
                }
                
                if (hologram.holon === 'warehouse') {
                    console.log('    -> Updating warehouse inventory system');
                    // updateWarehouseInventory(hologram.key);
                }
            }
        } else {
            console.log('No holograms were updated.');
        }
        
        // 5. Verify the holograms have the updated timestamp
        console.log('Step 5: Verifying hologram updates...');
        const storefrontHologram = await holosphere.get('storefront', 'display', 'featured-product', null, { resolveHolograms: false });
        const warehouseHologram = await holosphere.get('warehouse', 'inventory', 'stock-item', null, { resolveHolograms: false });
        
        console.log('Storefront hologram updated field:', storefrontHologram?.updated);
        console.log('Warehouse hologram updated field:', warehouseHologram?.updated);
        
    } catch (error) {
        console.error('Error in example:', error);
    } finally {
        await holosphere.close();
    }
}

// Example usage scenarios:
console.log('=== Hologram Updates Return Value Example ===');
console.log('This example demonstrates how to use the updatedHolograms return value from put()');
console.log('to perform post-processing tasks when original data changes.\n');

exampleUsage().then(() => {
    console.log('\n=== Example completed ===');
    process.exit(0);
}).catch(error => {
    console.error('Example failed:', error);
    process.exit(1);
}); 