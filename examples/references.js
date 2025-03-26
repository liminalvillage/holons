import HoloSphere from './holosphere.js';

async function testReferenceFederation() {
    console.log('Starting reference federation test...');
    const holoSphere = new HoloSphere('test-references');
    
    try {
        const space1 = 'ref-test-space1';
        const space2 = 'ref-test-space2';
        
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
            id: 'ref-test-item',
            title: 'Reference Test',
            value: 200,
            tags: ['test', 'reference']
        };
        
        // Store data in space1
        await holoSphere.put(space1, 'items', testData);
        
        // Step 4: Propagate using references
        console.log('Step 4: Propagating with soul references...');
        const propResult = await holoSphere.propagate(space1, 'items', testData, {
            useReferences: true
        });
        console.log('Propagation result:', propResult);
        
        // Allow time for propagation
        console.log('Waiting for propagation...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 5: Verify that the data in space2 is a soul reference
        console.log('Step 5: Verifying soul reference was created...');
        const rawRef = await holoSphere.get(space2, 'items', 'ref-test-item', null, {
            resolveReferences: false
        });
        
        console.log('Raw reference data:', rawRef);
        console.log('Is soul reference:', !!rawRef?.soul);
        
        if (rawRef?.soul) {
            const soulParts = rawRef.soul.split('/');
            console.log('Soul parts:', soulParts);
            console.log('Soul refers to:', {
                app: soulParts[0], 
                holon: soulParts[1], 
                lens: soulParts[2], 
                key: soulParts[3]
            });
        }
        
        // Step 6: Verify reference resolution works
        console.log('Step 6: Verifying reference resolution...');
        const resolvedData = await holoSphere.get(space2, 'items', 'ref-test-item');
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
        
        // Step 8: Verify update is reflected through the reference
        console.log('Step 8: Verifying update is reflected in reference...');
        const reResolvedData = await holoSphere.get(space2, 'items', 'ref-test-item');
        console.log('Re-resolved data after update:', reResolvedData);
        
        // Step 9: Update directly through origin holon
        console.log('Step 9: Updating through the origin holon...');
        const originData = await holoSphere.get(space1, 'items', 'ref-test-item');
        
        const finalUpdate = {
            ...originData,
            value: 400,
            finalUpdate: true
        };
        
        await holoSphere.put(space1, 'items', finalUpdate);
        
        // Allow time for update to propagate
        console.log('Waiting for update to propagate...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 10: Verify update is visible through the reference
        console.log('Step 10: Verifying update is visible through the reference...');
        const originalAfterUpdate = await holoSphere.get(space1, 'items', 'ref-test-item');
        console.log('Original data after update:', originalAfterUpdate);
        
        const refAfterUpdate = await holoSphere.get(space2, 'items', 'ref-test-item');
        console.log('Reference resolved data after update:', refAfterUpdate);
        
        // Step 11: Test manual soul reference resolution
        console.log('Step 11: Testing manual soul reference resolution...');
        
        // Check what getAll returns
        console.log('Raw references from getAll in space2:');
        const allItems = await holoSphere.getAll(space2, 'items');
        console.log('getAll results:', allItems);
        
        if (allItems.length > 0 && allItems[0].soul) {
            console.log('Found a soul reference, resolving it manually:');
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
                { resolveReferences: false }
            );
            console.log('Manually resolved reference data:', originalData);
        }
        
        // Test getFederated with soul references
        console.log('\nTesting getFederated with soul references:');
        const federatedData = await holoSphere.getFederated(space2, 'items', {
            resolveReferences: true,
            idField: 'id'
        });
        
        console.log('getFederated results length:', federatedData.length);
        
        // Find the item by ID
        const federatedItem = federatedData.find(item => item.id === 'ref-test-item');
        console.log('Found federated item by ID:', federatedItem);
        
        // Check if federated data correctly resolves soul references
        if (federatedItem && federatedItem.value === 400 && federatedItem.finalUpdate) {
            console.log('SUCCESS: getFederated correctly resolved the soul reference!');
        } else {
            console.log('WARNING: getFederated may not be resolving soul references properly');
        }
        
        // Step 12: Clean up
        console.log('Step 12: Cleaning up...');
        await holoSphere.unfederate(space1, space2);
        await holoSphere.unfederate(space2, space1);
        
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Error in test:', error);
    } finally {
        await holoSphere.close();
    }
}

testReferenceFederation().catch(console.error); 