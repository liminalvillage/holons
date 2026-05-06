<script lang="ts">
	import Badges from '../../components/Badges.svelte';
	import { onMount } from 'svelte';

	let showBadges = false;
	let demoMode = true;

	// Sample badge data for demo purposes
	const sampleBadges = [
		{
			title: "First Contribution",
			description: "Awarded for making your first contribution to the community. This badge recognizes the courage to take the first step and join our collaborative efforts.",
			icon: "🌟",
			rarity: "common",
			created_at: "2024-01-15T10:30:00Z",
			created_by: "Community Admin",
			awarded_to: [
				{
					id: "user1",
					username: "alice_dev",
					first_name: "Alice",
					last_name: "Johnson",
					awarded_at: "2024-01-20T14:22:00Z",
					awarded_via: "qr_code"
				},
				{
					id: "user2",
					username: "bob_contributor",
					first_name: "Bob",
					last_name: "Smith",
					awarded_at: "2024-01-25T09:15:00Z",
					awarded_via: "qr_code"
				}
			]
		},
		{
			title: "Community Leader",
			description: "Recognized for exceptional leadership within the community. This badge is given to those who inspire others and drive positive change.",
			icon: "👑",
			rarity: "rare",
			created_at: "2024-01-10T08:00:00Z",
			created_by: "Community Admin",
			awarded_to: [
				{
					id: "user3",
					username: "sarah_leader",
					first_name: "Sarah",
					last_name: "Williams",
					awarded_at: "2024-02-01T16:45:00Z",
					awarded_via: "qr_code"
				}
			]
		},
		{
			title: "Innovation Pioneer",
			description: "Awarded for introducing groundbreaking ideas and innovative solutions that push the community forward.",
			icon: "🚀",
			rarity: "epic",
			created_at: "2024-01-05T12:00:00Z",
			created_by: "Community Admin",
			awarded_to: [
				{
					id: "user4",
					username: "mike_innovator",
					first_name: "Mike",
					last_name: "Chen",
					awarded_at: "2024-01-30T11:30:00Z",
					awarded_via: "qr_code"
				}
			]
		},
		{
			title: "Mentor",
			description: "Recognized for helping others grow and learn. This badge celebrates those who share knowledge and guide newcomers.",
			icon: "🎓",
			rarity: "uncommon",
			created_at: "2024-01-12T15:30:00Z",
			created_by: "Community Admin",
			awarded_to: [
				{
					id: "user5",
					username: "emma_teacher",
					first_name: "Emma",
					last_name: "Davis",
					awarded_at: "2024-01-28T13:20:00Z",
					awarded_via: "qr_code"
				}
			]
		},
		{
			title: "Sustainability Champion",
			description: "Awarded for promoting and implementing sustainable practices within the community and beyond.",
			icon: "🌱",
			rarity: "rare",
			created_at: "2024-01-08T09:15:00Z",
			created_by: "Community Admin",
			awarded_to: [
				{
					id: "user6",
					username: "david_green",
					first_name: "David",
					last_name: "Brown",
					awarded_at: "2024-01-22T10:00:00Z",
					awarded_via: "qr_code"
				}
			]
		},
		{
			title: "Collaboration Master",
			description: "Recognized for exceptional teamwork and collaboration skills that bring people together.",
			icon: "🤝",
			rarity: "common",
			created_at: "2024-01-18T14:45:00Z",
			created_by: "Community Admin",
			awarded_to: [
				{
					id: "user7",
					username: "lisa_team",
					first_name: "Lisa",
					last_name: "Garcia",
					awarded_at: "2024-01-26T15:30:00Z",
					awarded_via: "qr_code"
				}
			]
		}
	];

	onMount(() => {
		// Auto-show badges after a short delay for demo
		setTimeout(() => {
			showBadges = true;
		}, 500);
	});
</script>

<svelte:head>
	<title>Badges Demo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-indigo-900 flex items-center justify-center p-4">
	<div class="text-center">
		{#if !showBadges}
			<div class="mb-8">
				<h1 class="text-5xl font-bold text-white mb-4">🏆</h1>
				<h2 class="text-3xl font-bold text-white mb-4">Badges Component Demo</h2>
				<p class="text-white/60 text-lg mb-6">
					Loading the badges showcase...
				</p>
				<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-white/50 mx-auto"></div>
			</div>
		{:else}
			<Badges isVisible={true} />
		{/if}
	</div>
</div>

<style>
	/* Demo-specific styles */
	:global(body) {
		margin: 0;
		padding: 0;
	}
</style>
