<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let demoActions = [
		{
			id: 'role-example',
			title: 'Role Assignment',
			description: 'Assign a specific role to a user',
			action: 'role',
			example: {
				action: 'role',
				title: 'Event Organizer',
				desc: 'Responsible for organizing community events',
				holonID: 'demo-holon-123',
				deckId: 'events-deck',
				cardId: 'organizer-role'
			},
			url: '/qr?action=role&title=Event%20Organizer&desc=Responsible%20for%20organizing%20community%20events&holonID=demo-holon-123&deckId=events-deck&cardId=organizer-role'
		},
		{
			id: 'event-example',
			title: 'Event Participation',
			description: 'Join a specific event or activity',
			action: 'event',
			example: {
				action: 'event',
				title: 'Community Workshop',
				desc: 'Join our monthly community building workshop',
				holonID: 'demo-holon-123',
				deckId: 'workshops-deck',
				cardId: 'workshop-001'
			},
			url: '/qr?action=event&title=Community%20Workshop&desc=Join%20our%20monthly%20community%20building%20workshop&holonID=demo-holon-123&deckId=workshops-deck&cardId=workshop-001'
		},
		{
			id: 'task-example',
			title: 'Task Assignment',
			description: 'Assign a specific task to a user',
			action: 'task',
			example: {
				action: 'task',
				title: 'Content Creation',
				desc: 'Create weekly community newsletter content',
				holonID: 'demo-holon-123',
				deckId: 'tasks-deck',
				cardId: 'newsletter-task'
			},
			url: '/qr?action=task&title=Content%20Creation&desc=Create%20weekly%20community%20newsletter%20content&holonID=demo-holon-123&deckId=tasks-deck&cardId=newsletter-task'
		},
		{
			id: 'badge-example',
			title: 'Badge Award',
			description: 'Award a badge or achievement to a user',
			action: 'badge',
			example: {
				action: 'badge',
				title: 'First Contribution',
				desc: 'Awarded for making your first contribution to the community',
				holonID: 'demo-holon-123',
				deckId: 'badges-deck',
				cardId: 'first-contribution'
			},
			url: '/qr?action=badge&title=First%20Contribution&desc=Awarded%20for%20making%20your%20first%20contribution%20to%20the%20community&holonID=demo-holon-123&deckId=badges-deck&cardId=first-contribution'
		},
		{
			id: 'invite-example',
			title: 'Invitation',
			description: 'Process an invitation to join or participate',
			action: 'invite',
			example: {
				action: 'invite',
				title: 'Community Invitation',
				desc: 'Invitation to join our community from John Doe',
				holonID: 'demo-holon-123',
				deckId: 'invites-deck',
				cardId: 'invite-001'
			},
			url: '/qr?action=invite&title=Community%20Invitation&desc=Invitation%20to%20join%20our%20community%20from%20John%20Doe&holonID=demo-holon-123&deckId=invites-deck&cardId=invite-001'
		}
	];

	function testQRAction(url: string) {
		goto(url);
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text).then(() => {
			// Show a brief success message
			const button = event?.target as HTMLButtonElement;
			if (button) {
				const originalText = button.textContent;
				button.textContent = 'Copied!';
				button.classList.add('bg-green-600');
				setTimeout(() => {
					button.textContent = originalText;
					button.classList.remove('bg-green-600');
				}, 2000);
			}
		});
	}
</script>

<svelte:head>
	<title>QR Code Demo - Automated Actions</title>
	<meta name="description" content="Demo of QR code automated actions in Holons" />
</svelte:head>

<div class="demo-page">
	<div class="max-w-6xl mx-auto p-6">
		<!-- Header -->
		<div class="text-center mb-12">
			<h1 class="text-4xl font-bold text-white mb-4">QR Code Automated Actions Demo</h1>
			<p class="text-xl text-gray-300 max-w-3xl mx-auto">
				See how QR codes can automatically perform actions like role assignment, event participation, 
				task assignment, badge awards, and more when scanned with Telegram authentication.
			</p>
		</div>

		<!-- Demo Actions Grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
			{#each demoActions as action}
				<div class="bg-gray-800 rounded-2xl p-6 border border-gray-700 hover:border-gray-600 transition-colors">
					<div class="flex items-center gap-3 mb-4">
						<div class="text-3xl">
							{action.action === 'role' && '👑'}
							{action.action === 'event' && '🎉'}
							{action.action === 'task' && '📋'}
							{action.action === 'badge' && '🏆'}
							{action.action === 'invite' && '📨'}
						</div>
						<div>
							<h3 class="text-lg font-semibold text-white">{action.title}</h3>
							<p class="text-sm text-gray-400">{action.description}</p>
						</div>
					</div>

					<div class="space-y-3 mb-6">
						<div class="text-xs text-gray-500 space-y-1">
							<div><strong>Action:</strong> {action.example.action}</div>
							<div><strong>Title:</strong> {action.example.title}</div>
							<div><strong>Description:</strong> {action.example.desc}</div>
							<div><strong>Holon ID:</strong> {action.example.holonID}</div>
							{#if action.example.deckId}
								<div><strong>Deck ID:</strong> {action.example.deckId}</div>
							{/if}
							{#if action.example.cardId}
								<div><strong>Card ID:</strong> {action.example.cardId}</div>
							{/if}
						</div>
					</div>

					<div class="flex gap-2">
						<button 
							on:click={() => testQRAction(action.url)}
							class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-xl transition-colors text-sm"
						>
							🧪 Test Action
						</button>
						<button 
							on:click={() => copyToClipboard(action.url)}
							class="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-3 rounded-xl transition-colors text-sm"
							title="Copy URL"
						>
							📋
						</button>
					</div>
				</div>
			{/each}
		</div>

		<!-- How It Works -->
		<div class="bg-gray-800 rounded-2xl p-8 mb-8">
			<h2 class="text-2xl font-bold text-white mb-6 text-center">How It Works</h2>
			
			<div class="grid grid-cols-1 md:grid-cols-3 gap-8">
				<div class="text-center">
					<div class="text-4xl mb-4">📱</div>
					<h3 class="text-lg font-semibold text-white mb-2">1. Scan QR Code</h3>
					<p class="text-gray-400 text-sm">
						Scan the QR code with your phone's camera or QR scanner app
					</p>
				</div>
				
				<div class="text-center">
					<div class="text-4xl mb-4">🔐</div>
					<h3 class="text-lg font-semibold text-white mb-2">2. Telegram Login</h3>
					<p class="text-gray-400 text-sm">
						Authenticate with your Telegram account to verify your identity
					</p>
				</div>
				
				<div class="text-center">
					<div class="text-4xl mb-4">⚡</div>
					<h3 class="text-lg font-semibold text-white mb-2">3. Automatic Action</h3>
					<p class="text-gray-400 text-sm">
						The system automatically performs the action (role assignment, event join, etc.)
					</p>
				</div>
			</div>
		</div>

		<!-- Debug Mode Notice -->
		<div class="bg-yellow-900 bg-opacity-30 border border-yellow-500 rounded-2xl p-8 mb-8">
			<h2 class="text-2xl font-bold text-yellow-400 mb-6 text-center">🔧 Debug Mode</h2>
			
			<div class="text-center mb-6">
				<p class="text-yellow-200 text-lg mb-4">
					When running from localhost, the system automatically enters debug mode:
				</p>
				<ul class="text-yellow-100 text-sm space-y-2 text-left max-w-2xl mx-auto">
					<li>• <strong>Telegram login is completely bypassed</strong></li>
					<li>• <strong>Actions use hardcoded user ID:</strong> 235114395</li>
					<li>• <strong>Original holon ID from QR code is preserved</strong></li>
					<li>• <strong>Mock user is automatically created</strong> for testing</li>
					<li>• <strong>Perfect for development and testing</strong> without external dependencies</li>
				</ul>
			</div>
			
			<div class="bg-yellow-800 bg-opacity-50 rounded-lg p-4 text-center">
				<p class="text-yellow-100 text-sm">
					<strong>To enable debug mode:</strong> Set <code class="bg-yellow-900 px-2 py-1 rounded">VITE_LOCAL_MODE=development</code> in your <code class="bg-yellow-900 px-2 py-1 rounded">.env</code> file
				</p>
			</div>
		</div>

		<!-- Use Cases -->
		<div class="bg-gray-800 rounded-2xl p-8">
			<h2 class="text-2xl font-bold text-white mb-6 text-center">Use Cases</h2>
			
			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div class="space-y-4">
					<h3 class="text-lg font-semibold text-white">🏢 Business & Organizations</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• Employee onboarding and role assignment</li>
						<li>• Event check-ins and participation tracking</li>
						<li>• Training completion and certification</li>
						<li>• Access control and permissions</li>
					</ul>
				</div>
				
				<div class="space-y-4">
					<h3 class="text-lg font-semibold text-white">🎓 Education & Events</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• Student registration and course enrollment</li>
						<li>• Conference and workshop participation</li>
						<li>• Achievement and badge systems</li>
						<li>• Group formation and team building</li>
					</ul>
				</div>
				
				<div class="space-y-4">
					<h3 class="text-lg font-semibold text-white">🏘️ Communities & Groups</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• Member role assignment and permissions</li>
						<li>• Event organization and participation</li>
						<li>• Task delegation and tracking</li>
						<li>• Invitation and referral systems</li>
					</ul>
				</div>
				
				<div class="space-y-4">
					<h3 class="text-lg font-semibold text-white">🎯 Gamification</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• Achievement unlocking and progress tracking</li>
						<li>• Reward distribution and redemption</li>
						<li>• Challenge participation and completion</li>
						<li>• Social recognition and status</li>
					</ul>
				</div>
			</div>
		</div>

		<!-- Technical Details -->
		<div class="bg-gray-800 rounded-2xl p-8 mt-8">
			<h2 class="text-2xl font-bold text-white mb-6 text-center">Technical Implementation</h2>
			
			<div class="space-y-6">
				<div>
					<h3 class="text-lg font-semibold text-white mb-3">🔒 Security Features</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• Telegram Web App authentication for secure user identification</li>
						<li>• Holon-based access control and permissions</li>
						<li>• Action validation and parameter sanitization</li>
						<li>• Audit trail for all automated actions</li>
					</ul>
				</div>
				
				<div>
					<h3 class="text-lg font-semibold text-white mb-3">⚙️ System Architecture</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• HoloSphere backend for decentralized data storage</li>
						<li>• Real-time updates and synchronization</li>
						<li>• Modular action system for easy extension</li>
						<li>• RESTful API endpoints for external integration</li>
					</ul>
				</div>
				
				<div>
					<h3 class="text-lg font-semibold text-white mb-3">📱 User Experience</h3>
					<ul class="text-gray-400 text-sm space-y-2">
						<li>• One-tap Telegram authentication</li>
						<li>• Instant action processing and feedback</li>
						<li>• Automatic navigation to relevant sections</li>
						<li>• Mobile-optimized responsive design</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</div>

<style lang="scss">
	.demo-page {
		min-height: 100vh;
		background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
		padding: 2rem 0;
	}

	.grid {
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	}
</style>
