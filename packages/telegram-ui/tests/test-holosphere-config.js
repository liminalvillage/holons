import { HoloSphere } from 'holosphere';

const hs = new HoloSphere({
  backend: 'gundb',
  appName: 'Test',
  privateKey: '0'.repeat(64),
  gundb: {
    peers: ['https://gun.holons.io/gun'],
    radisk: true,
    localStorage: false,
  },
});

console.log('Raw config:', JSON.stringify(hs._rawConfig, null, 2));
console.log('\nBackend:', hs._backend);
console.log('Backend ready:', hs._backendReady);

// Wait for backend to init
await new Promise(r => setTimeout(r, 2000));

console.log('\nAfter init:');
console.log('Backend:', hs._backend);
if (hs._backend) {
  console.log('Backend config:', hs._backend.config);
  console.log('Backend gun:', hs._backend.gun);
}

process.exit(0);
