/**
 * Organization Federation Example for HoloSphere
 * 
 * This example demonstrates a real-world use case where a tech team creates tasks
 * that are federated to the parent organization for visibility.
 */

import HoloSphere from './holosphere.js';

async function organizationFederationExample() {
  const holoSphere = new HoloSphere('organization-example');
  
  try {
    console.log('Starting Organization Federation Example...');
    
    // Define our spaces/holons
    const orgHolon = 'acme-organization';
    const techTeamHolon = 'acme-tech-team';
    
    // Step 1: Create federation relationship between tech team and organization
    console.log('\nStep 1: Creating federation relationship...');
    
    await holoSphere.federate(techTeamHolon, orgHolon);
    console.log('Federation created between tech team and organization');
    
    // Step 2: Set up bidirectional notification settings (critical!)
    console.log('\nStep 2: Setting up bidirectional notification...');
    
    // First set up tech team to notify organization
    const techTeamFedSettings = await holoSphere.getGlobal('federation', techTeamHolon);
    if (techTeamFedSettings) {
      techTeamFedSettings.notify = techTeamFedSettings.notify || [];
      if (!techTeamFedSettings.notify.includes(orgHolon)) {
        techTeamFedSettings.notify.push(orgHolon);
        await holoSphere.putGlobal('federation', techTeamFedSettings);
        console.log('Tech team set to notify organization');
      }
    }
    
    // Then set up organization to notify tech team (if needed)
    const orgFedSettings = await holoSphere.getGlobal('federation', orgHolon);
    if (orgFedSettings) {
      orgFedSettings.notify = orgFedSettings.notify || [];
      if (!orgFedSettings.notify.includes(techTeamHolon)) {
        orgFedSettings.notify.push(techTeamHolon);
        await holoSphere.putGlobal('federation', orgFedSettings);
        console.log('Organization set to notify tech team');
      }
    }
    
    // Step 3: Verify federation is set up properly
    console.log('\nStep 3: Verifying federation setup...');
    
    const techTeamFedInfo = await holoSphere.getFederation(techTeamHolon);
    console.log('Tech team federation info:', techTeamFedInfo);
    
    // Step 4: Create a task in the tech team holon
    console.log('\nStep 4: Creating a task in the tech team holon...');
    
    const task = {
      id: 'task-123',
      title: 'Implement new authentication system',
      description: 'Replace the current auth system with OAuth2',
      assignee: 'dev@example.com',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2023-12-31',
      createdAt: new Date().toISOString(),
      tags: ['security', 'infrastructure']
    };
    
    // Store the task in the tech team holon
    await holoSphere.put(techTeamHolon, 'tasks', task);
    console.log('Task created in tech team holon:', task.id);
    
    // Step 5: Propagate the task to the organization holon
    console.log('\nStep 5: Propagating task to organization holon...');
    
    await holoSphere.propagate(techTeamHolon, 'tasks', task);
    console.log('Task propagated to organization holon');
    
    // Step 6: Allow time for propagation
    console.log('\nStep 6: Waiting for propagation to complete...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 7: Verify task in both holons
    console.log('\nStep 7: Verifying task is in both holons...');
    
    // Check tech team holon directly
    const techTeamTask = await holoSphere.get(techTeamHolon, 'tasks', 'task-123');
    console.log('Task in tech team holon:', techTeamTask ? 'Found' : 'Not found');
    if (techTeamTask) console.log('Tech team task status:', techTeamTask.status);
    
    // Check organization holon directly
    const orgTask = await holoSphere.get(orgHolon, 'tasks', 'task-123');
    console.log('Task in organization holon:', orgTask ? 'Found' : 'Not found');
    if (orgTask) {
      console.log('Organization task status:', orgTask.status);
      console.log('Federation metadata:', orgTask.federation);
    }
    
    // Step 8: Use getFederated to view all tasks across holons
    console.log('\nStep 8: Using getFederated to view all tasks...');
    
    const allOrgTasks = await holoSphere.getFederated(orgHolon, 'tasks');
    console.log(`Organization holon has access to ${allOrgTasks.length} tasks`);
    
    const allTechTasks = await holoSphere.getFederated(techTeamHolon, 'tasks');
    console.log(`Tech team holon has access to ${allTechTasks.length} tasks`);
    
    // Step 9: Update the task in tech team and propagate the change
    console.log('\nStep 9: Updating task in tech team holon...');
    
    const updatedTask = {
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString()
    };
    
    await holoSphere.put(techTeamHolon, 'tasks', updatedTask);
    await holoSphere.propagate(techTeamHolon, 'tasks', updatedTask);
    console.log('Task updated and propagated');
    
    // Step 10: Allow time for propagation
    console.log('\nStep 10: Waiting for propagation to complete...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 11: Verify updates in both holons
    console.log('\nStep 11: Verifying updated task in both holons...');
    
    const updatedTechTeamTask = await holoSphere.get(techTeamHolon, 'tasks', 'task-123');
    console.log('Updated task in tech team holon status:', updatedTechTeamTask?.status);
    
    const updatedOrgTask = await holoSphere.get(orgHolon, 'tasks', 'task-123');
    console.log('Updated task in organization holon status:', updatedOrgTask?.status);
    
    // Step 12: Clean up - remove federation
    console.log('\nStep 12: Cleaning up - removing federation...');
    
    await holoSphere.unfederate(techTeamHolon, orgHolon);
    console.log('Federation removed between tech team and organization');
    
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