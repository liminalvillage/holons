import HoloSphere from '../holosphere.js';

async function testHologramFederation() {
    console.log('Starting hologram federation test...');
    const holoSphere = new HoloSphere('test-holograms');
    
    try {
        const space1 = 'holo-test-space1';
        const space2 = 'holo-test-space2';
        
        // Step 1: Create federation with bidirectional notify settings
        console.log('Step 1: Creating federation between spaces...');
        await holoSphere.federate(space1, space2);
        
        // Also federate from space2 to space1 for testing getFederated
        await holoSphere.federate(space2, space1);
        
        // Step 2: Verify federation is set up properly
        const fedInfo = await holoSphere.getFederation(space1);
        console.log('Federation info for space1:', fedInfo);
        
        const fedInfo2 = await holoSphere.getFederation(space2);
        console.log('Federation info for space2:', fedInfo2);
        
        // Step 3: Create test data
        console.log('Step 3: Creating test data...');
        const testData = {
            id: 'holo-test-item',
            title: 'Hologram Test',
            value: 200,
            tags: ['test', 'hologram']
        };
        
        // Store data in space1
        await holoSphere.put(space1, 'items', testData);
        
        // Step 4: Propagate using holograms
        console.log('Step 4: Propagating with soul holograms...');
        const propResult = await holoSphere.propagate(space1, 'items', testData, {
            useHolograms: true
        });
        console.log('Propagation result:', propResult);
        
        // Allow time for propagation
        console.log('Waiting for propagation...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 5: Verify that the data in space2 is a soul hologram
        console.log('Step 5: Verifying soul hologram was created...');
        const rawHolo = await holoSphere.get(space2, 'items', 'holo-test-item', null, {
            resolveHolograms: false
        });
        
        console.log('Raw hologram data:', rawHolo);
        console.log('Is soul hologram:', holoSphere.isHologram(rawHolo));
        
        if (rawHolo?.soul) {
            const soulParts = rawHolo.soul.split('/');
            console.log('Soul parts:', soulParts);
            console.log('Soul refers to:', {
                app: soulParts[0], 
                holon: soulParts[1], 
                lens: soulParts[2], 
                key: soulParts[3]
            });
        }
        
        // Step 6: Verify hologram resolution works
        console.log('Step 6: Verifying hologram resolution...');
        const resolvedData = await holoSphere.get(space2, 'items', 'holo-test-item');
        console.log('Resolved data:', resolvedData);
        
        // Step 7: Update the original data
        console.log('Step 7: Updating original data...');
        const updatedData = {
            ...testData,
            value: 300,
            updated: true
        };
        
        await holoSphere.put(space1, 'items', updatedData);
        
        // Allow time for update to propagate
        console.log('Waiting for update...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 8: Verify update is reflected through the hologram
        console.log('Step 8: Verifying update is reflected in hologram...');
        const reResolvedData = await holoSphere.get(space2, 'items', 'holo-test-item');
        console.log('Re-resolved data after update:', reResolvedData);
        
        // Step 9: Update directly through origin holon
        console.log('Step 9: Updating through the origin holon...');
        const originData = await holoSphere.get(space1, 'items', 'holo-test-item');
        
        const finalUpdate = {
            ...originData,
            value: 400,
            finalUpdate: true
        };
        
        await holoSphere.put(space1, 'items', finalUpdate);
        
        // Allow time for update to propagate
        console.log('Waiting for final update...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 10: Verify final update through the hologram in space2
        console.log('Step 10: Verifying final update is reflected...');
        const finalResolvedData = await holoSphere.get(space2, 'items', 'holo-test-item');
        console.log('Final resolved data:', finalResolvedData);
        
        // Step 11: Test manual soul hologram resolution
        console.log('Step 11: Testing manual soul hologram resolution...');
        
        // Check what getAll returns
        console.log('Raw holograms from getAll in space2:');
        const allItems = await holoSphere.getAll(space2, 'items');
        console.log('getAll results:', allItems);
        
        if (allItems.length > 0 && allItems[0].soul) {
            console.log('Found a soul hologram, resolving it manually:');
            const soulParts = allItems[0].soul.split('/');
            
            const originHolon = soulParts[1];
            const originLens = soulParts[2];
            const originKey = soulParts[3];
            
            console.log(`Soul path components: holon=${originHolon}, lens=${originLens}, key=${originKey}`);
            
            const originalData = await holoSphere.get(
                originHolon,
                originLens,
                originKey,
                null,
                { resolveHolograms: false }
            );
            console.log('Manually resolved hologram data:', originalData);
        }
        
        // Test getFederated with holograms
        console.log('\nTesting getFederated with holograms:');
        const federatedData = await holoSphere.getFederated(space2, 'items', {
            resolveHolograms: true,
            idField: 'id'
        });
        
        console.log('getFederated results length:', federatedData.length);
        
        // Find the item by ID
        const federatedItem = federatedData.find(item => item.id === 'holo-test-item');
        console.log('Found federated item by ID:', federatedItem);
        
        // Check if federated data correctly resolves soul holograms
        if (federatedItem && federatedItem.value === 400 && federatedItem.finalUpdate) {
            console.log('SUCCESS: getFederated correctly resolved the soul hologram!');
        } else {
            console.log('WARNING: getFederated may not be resolving soul holograms properly');
        }
        
        // Step 12: Clean up
        console.log('Step 12: Cleaning up...');
        await holoSphere.unfederate(space1, space2);
        await holoSphere.unfederate(space2, space1);
        
        console.log('Hologram federation test completed successfully!');
    } catch (error) {
        console.error('Hologram federation test failed:', error);
    } finally {
        await holoSphere.close();
        console.log('HoloSphere connection closed.');
    }
}

testHologramFederation(); 