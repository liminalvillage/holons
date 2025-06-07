import Gun from 'gun';
import fs from 'fs';
import path from 'path';

async function mergeGunData() {
  console.log('Starting Gun data merge...');

  // Create instances for each existing data folder
  const gun1 = Gun({ file: 'data' });
  const gun2 = Gun({ file: 'gun_data.db' });
  const mergedGun = Gun({ file: 'shared_gun_data' });

  // Function to copy all data from one Gun instance to another
  function copyGunData(sourceGun, targetGun) {
    return new Promise((resolve) => {
      let count = 0;
      
      sourceGun.map().once((data, key) => {
        if (data && key) {
          console.log(`Copying key: ${key}`);
          targetGun.get(key).put(data);
          count++;
        }
      });
      
      setTimeout(() => {
        console.log(`Copied ${count} records`);
        resolve();
      }, 5000); // Wait 5 seconds for data to sync
    });
  }

  try {
    // Copy data from both sources to the merged instance
    await copyGunData(gun1, mergedGun);
    await copyGunData(gun2, mergedGun);
    
    console.log('Data merge completed successfully!');
    console.log('You can now delete the old data folders: "data" and "gun_data.db"');
    
  } catch (error) {
    console.error('Error during data merge:', error);
  }
}

// Run the merge
mergeGunData(); 