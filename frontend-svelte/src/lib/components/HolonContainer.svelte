<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getWeb3 } from '$lib/libs/web3';
	// @ts-ignore
	import Identicon from 'identicon.js';
	import holonData from '$lib/data/Holon.json' assert { type: 'json' };
	import factoryData from '$lib/data/AppreciativeFactory.json' assert { type: 'json' };
	import Modal from './Modal.svelte';
	import Stats from './Stats.svelte';
	import HolonAddEntity from './HolonAddEntity.svelte';
	import type Web3 from 'web3';
	import type { Contract } from 'web3-eth-contract';

	interface Props {
		holonNav?: string;
	}

	let { holonNav }: Props = $props();

	interface HolonMember {
		address: string;
		name: string;
		appreciation: string;
		remainingappreciation: string;
		rewards: string;
		profile: string;
		img: string;
	}

	interface HolonListItem {
		address: string;
		name: string;
	}

	let web3: Web3;
	let defaultAccount = $state('');
	let holonContract: Contract<any>;
	let factoryContract: Contract<any>;
	let holonList = $state<HolonListItem[]>([]);
	let holonName = $state('');
	let holonMembers = $state<HolonMember[]>([]);
	let holonAddress = $state('');
	let castedAppreciation = $state(0);
	let totalAppreciation = $state(0);
	let totalRewards = $state(0);
	let userIndex = $state(-1);
	let showAddField = $state(false);
	let showAddAppreciationModal = $state(false);
	let addAppreciationModal = $state({
		holon: false,
		header: '',
		target: '',
		amount: 0,
		maxAmount: 100
	});

	const homeHolon = '0xB393F06145278F3B69B6E23dD403Fc3985f329D4';
	const factoryAddress = factoryData.address;
	const holonAbi = holonData.abi;
	const factoryAbi = factoryData.abi;

	const circleClasses = [
		'row-3 c-2',
		'row-2 c-3',
		'row-3 c-4',
		'row-5 c-4',
		'row-6 c-3',
		'row-5 c-2',
		'row-1 c-3',
		'row-2 c-5',
		'row-6 c-5',
		'row-7 c-3',
		'row-6 c-1',
		'row-2 c-1'
	];

	function getCircleClass(index: number): string {
		return circleClasses[index] || '';
	}

	async function connectWeb3() {
		try {
			web3 = await getWeb3();
			const accounts = await web3.eth.getAccounts();
			defaultAccount = accounts[0] || '';

			holonContract = new web3.eth.Contract(holonAbi as any, holonAddress);
			factoryContract = new web3.eth.Contract(factoryAbi as any, factoryAddress);

			if (defaultAccount) {
				await makeHolonList();
				await getTeam();
			}
		} catch (error) {
			console.error('Failed to connect Web3:', error);
		}
	}

	async function makeHolonList() {
		try {
			const data = await factoryContract.methods.listHolonsOf(defaultAccount).call();
			if (data) {
				holonList = data.map((address: string) => ({
					address,
					name: ''
				}));

				for (let i = 0; i < data.length; i++) {
					getHolonName(data[i], i);
				}
			}
		} catch (error) {
			console.error('Failed to get holon list:', error);
		}
	}

	async function getHolonName(address: string, index: number) {
		try {
			const name = await factoryContract.methods.toName(address).call();
			holonList[index].name = String(name);
		} catch (error) {
			console.error('Failed to get holon name:', error);
		}
	}

	async function getTeam() {
		try {
			const members = await holonContract.methods.listMembers().call();
			makeTeam(members as any);
		} catch (error) {
			console.error('Failed to get team:', error);
		}
	}

	function makeTeam(members: string[]) {
		holonMembers = members.map((address) => ({
			address,
			name: '',
			appreciation: '',
			remainingappreciation: '',
			rewards: '',
			profile: '',
			img: ''
		}));

		members.forEach((_, index) => {
			getName(index);
			getAppreciation(index);
			getRemainingAppreciation(index);
			get3boxData(index);
		});

		findMe();
	}

	async function get3boxData(index: number) {
		try {
			const response = await fetch(
				`https://ipfs.3box.io/profile?address=${holonMembers[index].address}`
			);
			const data = await response.json();

			if (data.status === 'error') {
				const image = new Identicon(holonMembers[index].address, 420).toString();
				holonMembers[index].img = 'data:image/png;base64,' + image;
			} else if (data.image) {
				holonMembers[index].img = 'https://ipfs.io/ipfs/' + data.image[0].contentUrl['/'];
			}
		} catch (error) {
			const image = new Identicon(holonMembers[index].address, 420).toString();
			holonMembers[index].img = 'data:image/png;base64,' + image;
		}
	}

	async function getName(index: number) {
		try {
			const name = await holonContract.methods.toName(holonMembers[index].address).call();
			holonMembers[index].name = String(name);
		} catch (error) {
			console.error('Failed to get name:', error);
		}
	}

	async function getRemainingAppreciation(index: number) {
		try {
			const remaining = await holonContract.methods
				.remainingappreciation(holonMembers[index].address)
				.call();
			holonMembers[index].remainingappreciation = String(remaining);
		} catch (error) {
			console.error('Failed to get remaining appreciation:', error);
		}
	}

	async function getAppreciation(index: number) {
		try {
			const appreciation = await holonContract.methods
				.appreciation(holonMembers[index].address)
				.call();
			holonMembers[index].appreciation = String(appreciation);
		} catch (error) {
			console.error('Failed to get appreciation:', error);
		}
	}

	function findMe() {
		userIndex = holonMembers.findIndex((x) => x.address === defaultAccount);
	}

	async function sendAppreciation(address: string, amount: number) {
		try {
			await holonContract.methods.appreciate(address, amount).send({ from: defaultAccount });
			if (userIndex >= 0) {
				await getRemainingAppreciation(userIndex);
			}
		} catch (error) {
			console.error('Failed to send appreciation:', error);
		}
		closeAddAppreciationModal();
	}

	async function sendFunds(address: string, amount: number) {
		try {
			await web3.eth.sendTransaction({
				from: defaultAccount,
				to: address,
				value: web3.utils.toWei(amount.toString(), 'ether')
			});
		} catch (error) {
			console.error('Failed to send funds:', error);
		}
		closeAddAppreciationModal();
	}

	async function addMember(event: CustomEvent<{ address: string; name: string }>) {
		try {
			const { address, name } = event.detail;
			await holonContract.methods.addMember(address, name).send({ from: defaultAccount });
			showAddField = false;
		} catch (error) {
			console.error('Failed to add member:', error);
		}
	}

	async function newHolon(event: CustomEvent<{ name: string }>) {
		try {
			const { name } = event.detail;
			await factoryContract.methods.newHolon(name).send({ from: defaultAccount });
			showAddField = false;
		} catch (error) {
			console.error('Failed to create holon:', error);
		}
	}

	async function openAddAppreciationModal(index: number | string, isHolon = false) {
		if (isHolon) {
			addAppreciationModal.holon = true;
			addAppreciationModal.target = holonAddress;
			addAppreciationModal.header = holonName;

			const balance = await web3.eth.getBalance(defaultAccount);
			addAppreciationModal.maxAmount = Number(web3.utils.fromWei(balance, 'ether'));
		} else {
			const idx = typeof index === 'number' ? index : parseInt(index);
			addAppreciationModal.holon = false;
			addAppreciationModal.target = holonMembers[idx].address;
			addAppreciationModal.header = holonMembers[idx].name;
			addAppreciationModal.maxAmount =
				userIndex >= 0 ? Number(holonMembers[userIndex].remainingappreciation) : 100;
		}

		showAddAppreciationModal = true;
	}

	function closeAddAppreciationModal() {
		addAppreciationModal = {
			holon: false,
			header: '',
			target: '',
			amount: 0,
			maxAmount: 100
		};
		showAddAppreciationModal = false;
	}

	function handleSendClick() {
		if (addAppreciationModal.holon) {
			sendFunds(addAppreciationModal.target, addAppreciationModal.amount);
		} else {
			sendAppreciation(addAppreciationModal.target, addAppreciationModal.amount);
		}
	}

	onMount(() => {
		if (holonNav) {
			const isEth = /^0x[a-fA-F0-9]{40}$/.test(holonNav);
			holonAddress = isEth ? holonNav : homeHolon;
		} else {
			holonAddress = homeHolon;
		}

		connectWeb3();
	});

	const minAmount = $derived(addAppreciationModal.holon ? 0 : 1);
	const stepSize = $derived(addAppreciationModal.holon ? 0.0001 : 1);
</script>

<div>
	<a class="holon-link mr-2" href={`/${homeHolon}`}>
		⭕⭕
	</a>
	{#each holonList as holon, index (holon.address + index)}
		<a class="holon-link" href={`/${holon.address}`}>
			⭕⭕
			<span>{holon.name}</span>
		</a>
	{/each}

	<div class="h-24 block min-w-full m-0">
		{#if holonName}
			<h1 id="v-step-0" class="text-5xl text-white">{holonName}</h1>
		{/if}
		<h3>{holonAddress}</h3>
	</div>

	<div class="m-grid-outer -mt-20">
		<div class="m-grid-container">
			<div class="circle row-4 c-3">
				<div class="c-inner profile-card text-white text-2xl">
					<div class="px-6 py-4">
						{holonName}
						<button
							class="v-step-2 bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
							onclick={() => openAddAppreciationModal(holonAddress, true)}
						>
							Send funds to holon
						</button>
					</div>
				</div>
			</div>

			{#each holonMembers as member, index (member.address + index)}
				<div class="circle v-step-4 {getCircleClass(index)}">
					<div
						class="c-inner profile-card inline-block my-4 rounded-full bg-cover bg-blue-900 h-32 w-32"
						style="background-image: url({member.img})"
					>
						<div class="px-6 py-4">
							<a href={`/${member.address}`}>
								<h2 class="font-bold text-xl text-white" title={member.address}>
									{member.name}
								</h2>
							</a>
						</div>
						<div>
							<Stats
								expanded={false}
								appreciation={member.appreciation}
								remaining={member.remainingappreciation}
								rewards={member.rewards}
								casted={castedAppreciation}
								totalrewards={totalRewards}
							/>
							{#if member.address !== defaultAccount}
								<button
									class="v-step-1 bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
									onclick={() => openAddAppreciationModal(index)}
								>
									send ❤️
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}

			<HolonAddEntity
				bind:showAddField
				on:addMember={addMember}
				on:addHolon={newHolon}
			/>
		</div>
	</div>

	{#if holonMembers.length > 0}
		<div>
			<h2 class="text-2xl text-white">Full member list</h2>
			<div class="flex mb-4 justify-center flex-wrap">
				{#each holonMembers as member, index (member.address + index)}
					<div
						class="p-4 text-white text-center max-w-md border border-blue-900 rounded-md m-3"
					>
						<span
							class="inline-block my-4 rounded-full bg-cover bg-blue-900 h-32 w-32"
							style="background-image: url({member.img})"
						></span>
						<a href={`/${member.address}`}>
							<div class="px-6 py-4 truncate max-w-xs">
								<h2 class="font-bold text-xl mb-2">{member.name}</h2>
								<small>{member.address}</small>
							</div>
						</a>

						<div class="max-w-xs">
							<Stats
								expanded={true}
								appreciation={member.appreciation}
								remaining={member.remainingappreciation}
								rewards={member.rewards}
								casted={castedAppreciation}
								totalrewards={totalRewards}
							/>

							<button
								class="bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
								onclick={() => openAddAppreciationModal(index)}
							>
								send ❤️
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if showAddAppreciationModal}
		<Modal header={`Send to ${addAppreciationModal.header}`} onClose={closeAddAppreciationModal}>
			{#snippet body()}
				<span class="text-blue-600 font-extrabold text-3xl">
					{addAppreciationModal.amount}
				</span>
				{#if addAppreciationModal.holon}
					<span class="text-gray-600 italic text-3xl pl-2">
						/ {addAppreciationModal.maxAmount} ETH
					</span>
				{:else}
					<span class="text-gray-600 italic text-3xl pl-2">
						/ {addAppreciationModal.maxAmount - addAppreciationModal.amount} ❤️
					</span>
				{/if}
				<div class="slidecontainer">
					<input
						type="range"
						min={minAmount}
						step={stepSize}
						max={addAppreciationModal.maxAmount}
						bind:value={addAppreciationModal.amount}
						class="slider"
					/>
				</div>
			{/snippet}
			{#snippet footer()}
				<button
					class="bg-blue-500 hover:bg-blue-700 text-white rounded-full px-3 py-1 text-sm font-semibold m-2"
					onclick={handleSendClick}
				>
					send ❤️
				</button>
			{/snippet}
		</Modal>
	{/if}
</div>
