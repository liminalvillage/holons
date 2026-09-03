/**
 * Organization Federation Example for HoloSphere (Updated API)
 * 
 * This example demonstrates a real-world use case where a tech team creates tasks
 * that are automatically federated to the parent organization for visibility using
 * the latest HoloSphere federation features.
 */

import HoloSphere from '../holosphere.js';

async function organizationFederationExample() {
  const holoSphere = new HoloSphere('organization-example-updated');
  
  try {
    console.log('Starting Organization Federation Example (Updated API)...');
    
    // Define unique names for this run to avoid conflicts
    const runId = Date.now();
    const orgHolon = `acme-org-${runId}`;
    const techTeamHolon = `acme-tech-${runId}`;
    
    // Step 1: Create federation relationship (bidirectional by default)
    console.log('\nStep 1: Creating federation relationship...');
    // The `federate` method automatically sets up bidirectional notifications when `bidirectional` is true (default).
    const federateResult = await holoSphere.federate(techTeamHolon, orgHolon); 
    if (!federateResult) {
        throw new Error('Federation setup failed.');
    }
    console.log(`Federation created between ${techTeamHolon} and ${orgHolon}`);
    
    // Allow a moment for relay propagation of federation settings
    await new Promise(resolve => setTimeout(resolve, 1500)); 

    // Step 2: Verify federation is set up properly
    console.log('\nStep 2: Verifying federation setup...');
    const techTeamFedInfo = await holoSphere.getFederation(techTeamHolon);
    console.log(`Tech team (${techTeamHolon}) federation info:`, techTeamFedInfo);
    if (!techTeamFedInfo?.federation?.includes(orgHolon)) {
        console.warn('Warning: Organization holon not found in tech team federation list.');
    }
    
    const orgFedInfo = await holoSphere.getFederation(orgHolon);
    console.log(`Organization (${orgHolon}) federation info:`, orgFedInfo);
    if (!orgFedInfo?.notify?.includes(techTeamHolon)) {
        console.warn('Warning: Tech team holon not found in organization notify list.');
    }

    // Step 3: Create a task in the tech team holon
    // The `put` method automatically propagates data to federated holons by default (`autoPropagate: true`).
    console.log('\nStep 3: Creating a task in the tech team holon (will auto-propagate)...');
    
    const task = {
      id: `task-${runId}-123`,
      title: 'Implement new authentication system',
      description: 'Replace the current auth system with OAuth2',
      assignee: 'dev@example.com',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2024-12-31',
      createdAt: new Date().toISOString(),
      tags: ['security', 'infrastructure']
    };
    
    // Store the task - it will be automatically propagated to orgHolon due to federation
    const putResult = await holoSphere.put(techTeamHolon, 'tasks', task);
    console.log(`Task created in ${techTeamHolon}: ${task.id}. Propagation result:`, putResult.propagationResult);
    if (putResult.propagationResult?.errors > 0) {
      console.warn('Warning: Auto-propagation reported errors.');
    }

    // Step 4: Allow time for propagation via put
    console.log('\nStep 4: Waiting for auto-propagation to complete...');
    await new Promise(resolve => setTimeout(resolve, 1500)); 
    
    // Step 5: Verify task in both holons
    console.log('\nStep 5: Verifying task is in both holons...');
    
    // Check tech team holon directly (original data)
    const techTeamTask = await holoSphere.get(techTeamHolon, 'tasks', task.id);
    console.log(`Task in tech team holon (${techTeamHolon}):`, techTeamTask ? 'Found' : 'Not found');
    if (techTeamTask) console.log('Tech team task status:', techTeamTask.status);
    
    // Check organization holon directly (should have a resolved reference)
    const orgTask = await holoSphere.get(orgHolon, 'tasks', task.id);
    console.log(`Task in organization holon (${orgHolon}):`, orgTask ? 'Found' : 'Not found');
    if (orgTask) {
      console.log('Organization task status:', orgTask.status);
      // Check if it's a resolved reference
      console.log('Is resolved reference:', !!orgTask._federation?.resolved); 
    } else {
      console.warn(`Task ${task.id} not found in organization holon ${orgHolon}. Propagation might have failed or is slow.`);
    }
    
    // Step 6: Use getFederated to view all tasks from the organization's perspective
    console.log('\nStep 6: Using getFederated to view all tasks...');
    
    const allOrgTasks = await holoSphere.getFederated(orgHolon, 'tasks');
    console.log(`Organization holon (${orgHolon}) has access to ${allOrgTasks.length} tasks (via getFederated):`);
    // console.log(allOrgTasks); // Uncomment to see the full list
    
    const allTechTasks = await holoSphere.getFederated(techTeamHolon, 'tasks');
    console.log(`Tech team holon (${techTeamHolon}) has access to ${allTechTasks.length} tasks (via getFederated):`);
    // console.log(allTechTasks); // Uncomment to see the full list

    // Step 7: Update the task in tech team holon (will also auto-propagate)
    console.log('\nStep 7: Updating task in tech team holon (will auto-propagate)...');
    
    const updatedTask = {
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString()
    };
    
    // Update the task - the change will be automatically propagated
    const updateResult = await holoSphere.put(techTeamHolon, 'tasks', updatedTask);
    console.log(`Task updated in ${techTeamHolon}. Propagation result:`, updateResult.propagationResult);
    if (updateResult.propagationResult?.errors > 0) {
      console.warn('Warning: Auto-propagation of update reported errors.');
    }
    
    // Step 8: Allow time for update propagation
    console.log('\nStep 8: Waiting for update propagation...');
    await new Promise(resolve => setTimeout(resolve, 1500)); 
    
    // Step 9: Verify updates in both holons
    console.log('\nStep 9: Verifying updated task in both holons...');
    
    const updatedTechTeamTask = await holoSphere.get(techTeamHolon, 'tasks', task.id);
    console.log(`Updated task status in tech team holon (${techTeamHolon}):`, updatedTechTeamTask?.status);
    
    // Get the potentially updated reference in the organization holon
    const updatedOrgTask = await holoSphere.get(orgHolon, 'tasks', task.id); 
    console.log(`Updated task status in organization holon (${orgHolon}):`, updatedOrgTask?.status);
    if (!updatedOrgTask || updatedOrgTask.status !== 'completed') {
        console.warn(`Updated task status not reflected in organization holon ${orgHolon}. Propagation might have failed or is slow.`);
    }

    // Step 10: Clean up - remove federation
    console.log('\nStep 10: Cleaning up - removing federation...');
    await holoSphere.unfederate(techTeamHolon, orgHolon);
    console.log(`Federation removed between ${techTeamHolon} and ${orgHolon}`);
    
    // Optional: Clean up data (can be slow)
    // console.log('Cleaning up task data...');
    // await holoSphere.delete(techTeamHolon, 'tasks', task.id);
    // await holoSphere.delete(orgHolon, 'tasks', task.id); // Delete the reference
    // await holoSphere.deleteGlobal('federation', techTeamHolon);
    // await holoSphere.deleteGlobal('federation', orgHolon);
    
    console.log('\nOrganization federation example completed successfully!');
    
  } catch (error) {
    console.error('Error in organization federation example:', error);
  } finally {
    // Always close the HoloSphere instance
    await holoSphere.close();
    console.log('HoloSphere instance closed');
  }
}

// Run the example
organizationFederationExample().catch(console.error); 