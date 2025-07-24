import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import managed from '../artifacts/ManagedABI.json' assert { type: 'json' };
import splitter from '../artifacts/SplitterABI.json' assert { type: 'json' };
import zoned from '../artifacts/ZonedABI.json' assert { type: 'json' };
import appreciative from '../artifacts/AppreciativeABI.json' assert { type: 'json' };
import holonsFactoryAbi from '../artifacts/HolonsFactoryABI.json' assert { type: 'json' };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const holonsContract = new ethers.Contract(
  process.env.HOLONS_CONTRACT,
  holonsFactoryAbi.abi,
  wallet
);

const testUsers = [
  { id: 'alice', wallet: process.env.ALICE_WALLET },
  { id: 'bob', wallet: process.env.BOB_WALLET }
];

const TOTAL_REWARD = ethers.parseEther("1.0");

const testCases = [
  {
    name: 'Only HOURS matters',
    equation: { hours: 1 },
    contributions: {
      alice: { hours: 10 },
      bob: { hours: 30 }
    },
    expectedRatio: [0.25, 0.75]
  },
  {
    name: 'Only INITIATED matters',
    equation: { initiated: 1 },
    contributions: {
      alice: { initiated: [1, 2] },
      bob: { initiated: [1, 2, 3, 4, 5, 6] }
    },
    expectedRatio: [0.25, 0.75]
  },
  {
    name: 'Mixed weights',
    equation: { initiated: 1, completed: 2, hours: 0.5 },
    contributions: {
      alice: { initiated: [1, 2], completed: [1, 2, 3], hours: 10 },
      bob: { initiated: [1, 2, 3], completed: [1, 2, 3, 4, 5, 6], hours: 20 }
    },
    expectedRatio: [13, 25].map(n => n / (13 + 25))
  },
  {
    name: 'One user does nothing',
    equation: { sent: 1, received: 1, hours: 1 },
    contributions: {
      alice: {},
      bob: { sent: 5, received: 5, hours: 10 }
    },
    expectedRatio: [0, 1]
  },
  {
    name: 'All weights equal',
    equation: { initiated: 1, completed: 1, sent: 1, received: 1, hours: 1 },
    contributions: {
      alice: { initiated: [1], completed: [1], sent: 1, received: 1, hours: 1 },
      bob: { initiated: [1,2,3], completed: [1,2,3], sent: 3, received: 3, hours: 3 }
    },
    expectedRatio: [5, 15].map(n => n / (5 + 15))
  }
];

async function getHolonContract(holonAddress) {
  const base = new ethers.Contract(holonAddress, managed.abi, wallet);
  const flavor = await base.flavor();
  switch (flavor) {
    case 'Zoned':
      return new ethers.Contract(holonAddress, zoned.abi, wallet);
    case 'Splitter':
      return new ethers.Contract(holonAddress, splitter.abi, wallet);
    case 'Appreciative':
      return new ethers.Contract(holonAddress, appreciative.abi, wallet);
    default:
      return base;
  }
}

async function syncScore(users, equation, contract) {
  const userIds = users.map(u => u.id);
  const scores = users.map(u => {
    const s =
      (u.initiated?.length || 0) * (equation.initiated || 0) +
      (u.completed?.length || 0) * (equation.completed || 0) +
      (u.sent || 0) * (equation.sent || 0) +
      (u.received || 0) * (equation.received || 0) +
      (u.hours || 0) * (equation.hours || 0) +
      (u.collaboration || 0) * (equation.collaboration || 0) +
      (u.wants?.length || 0) * (equation.wants || 0) +
      (u.offers?.length || 0) * (equation.offers || 0);
    return ethers.toBigInt(Math.max(0, Math.floor(s)));
  });

  const tx = await contract.setAppreciation(userIds, scores);
  await tx.wait();
  console.log(`✅ setAppreciation() complete`);
}

async function runTest(contract, chatID, testCase) {
  console.log(`\n🧪 Running test case: ${testCase.name}`);

  const users = testUsers.map(u => ({
    ...u,
    initiated: testCase.contributions[u.id]?.initiated || [],
    completed: testCase.contributions[u.id]?.completed || [],
    sent: testCase.contributions[u.id]?.sent || 0,
    received: testCase.contributions[u.id]?.received || 0,
    hours: testCase.contributions[u.id]?.hours || 0,
    collaboration: 0,
    wants: [],
    offers: []
  }));

  const before = {};
  for (const u of users) {
    before[u.id] = await provider.getBalance(u.wallet);
  }

  await syncScore(users, testCase.equation, contract);

  const rewardTx = await contract.reward(ethers.ZeroAddress, TOTAL_REWARD, {
    value: TOTAL_REWARD,
    gasLimit: 4_000_000
  });
  await rewardTx.wait();
  console.log(`✅ reward() complete`);

  for (const u of users) {
    const tx = await contract.claim(u.id, u.wallet);
    await tx.wait();
  }

  const after = {};
  for (const u of users) {
    after[u.id] = await provider.getBalance(u.wallet);
  }

  console.log(`Expected distribution: ${testCase.expectedRatio.map(r => `${(r * 100).toFixed(1)}%`).join(' / ')}`);
  users.forEach((u, i) => {
    const actual = after[u.id] - before[u.id];
    const expected = TOTAL_REWARD * BigInt(Math.floor(testCase.expectedRatio[i] * 1e6)) / 1_000_000n;
    const diff = actual > expected ? actual - expected : expected - actual;
    const ok = diff < ethers.parseEther("0.0001");
    console.log(`💸 ${u.id} got ${ethers.formatEther(actual)} ETH (expected ~${ethers.formatEther(expected)} ETH)`);
    if (!ok) console.error(`❌ Mismatch!`);
    else console.log(`✅ OK`);
  });
}

// Entry point
const chatID = -4829278292;

const runAll = async () => {
  const holonAddress = await holonsContract.toAddress(chatID.toString());
  if (holonAddress === ethers.ZeroAddress) throw new Error(`No holon for ${chatID}`);
  const contract = await getHolonContract(holonAddress);
  for (const test of testCases) await runTest(contract, chatID, test);
};

runAll().catch(console.error);
