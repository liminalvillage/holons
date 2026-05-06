<script lang="ts">
	import QRCode from '../../../components/QRCode.svelte';
</script>

<svelte:head>
	<title>QR Test Page</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 p-8">
	<div class="max-w-4xl mx-auto">
		<h1 class="text-3xl font-bold text-white mb-8">QR Component Test</h1>
		
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
			<!-- Badge Action - Automatic Assignment -->
			<div>
				<h2 class="text-xl font-bold text-white mb-4">Badge: First Helper</h2>
				<QRCode 
					action="badge" 
					title="First Helper" 
					desc="Awarded for helping newcomers"
					holonID="test-holon-123"
					deckId="helper-deck"
					cardId="first-helper-card"
				/>
			</div>
			
			<!-- Task Action - Creates Quest with User as Participant -->
			<div>
				<h2 class="text-xl font-bold text-white mb-4">Task: Community Cleanup</h2>
				<QRCode 
					action="task" 
					title="Community Cleanup"
					desc="Help organize the community space" 
					holonID="test-holon-123"
					deckId="task-deck"
					cardId="cleanup-task"
				/>
			</div>
			
			<!-- Event Action - Scheduled for 12 Hours -->
			<div>
				<h2 class="text-xl font-bold text-white mb-4">Event: Welcome Circle</h2>
				<QRCode 
					action="event" 
					title="Welcome Circle"
					desc="Weekly community welcome event"
					holonID="test-holon-123"
					deckId="event-deck"
					cardId="welcome-circle"
				/>
			</div>
			
			<!-- Role Action -->
			<div>
				<h2 class="text-xl font-bold text-white mb-4">Role: Community Leader</h2>
				<QRCode 
					action="role" 
					title="Community Leader"
					desc="Leadership role in the community"
					holonID="test-holon-123"
					deckId="role-deck"
					cardId="leader-role"
				/>
			</div>
			
			<!-- Badge with Special Characters -->
			<div>
				<h2 class="text-xl font-bold text-white mb-4">Badge: First+Helper</h2>
				<QRCode 
					action="badge" 
					title="First+Helper"
					desc="Special characters test"
					holonID="test-holon-123"
				/>
			</div>
		</div>
		
		<div class="mt-8 p-6 bg-gray-800 rounded-3xl">
			<h3 class="text-xl font-bold text-white mb-4">Test URLs</h3>
			<div class="space-y-2 text-sm">
				<p class="text-gray-300">
					<a href="/qr?action=badge&title=First+Helper&desc=Awarded+for+helping+newcomers&holonID=test-holon-123" class="text-blue-400 hover:text-blue-300">
						Badge: First Helper
					</a>
				</p>
				<p class="text-gray-300">
					<a href="/qr?action=task&title=Community+Cleanup&desc=Help+organize+the+community+space&holonID=test-holon-123" class="text-blue-400 hover:text-blue-300">
						Task: Community Cleanup
					</a>
				</p>
				<p class="text-gray-300">
					<a href="/qr?action=event&title=Welcome+Circle&desc=Weekly+community+welcome+event&holonID=test-holon-123" class="text-blue-400 hover:text-blue-300">
						Event: Welcome Circle (12h from now)
					</a>
				</p>
				<p class="text-gray-300">
					<a href="/qr?action=role&title=Community+Leader&desc=Leadership+role+in+the+community&holonID=test-holon-123" class="text-blue-400 hover:text-blue-300">
						Role: Community Leader
					</a>
				</p>
			</div>
			
			<div class="mt-6 p-4 bg-gray-700 rounded-2xl">
				<h4 class="text-lg font-bold text-white mb-2">✨ Enhanced QR Action System</h4>
				<ul class="text-sm text-gray-300 space-y-1">
					<li>• <strong>Badge:</strong> Automatically assigned to user after login</li>
					<li>• <strong>Task:</strong> Creates Quest object with user as participant</li>
					<li>• <strong>Event:</strong> Creates scheduled Quest for 12 hours from scan time</li>
					<li>• <strong>Role:</strong> Assigns role to user with full permissions</li>
					<li>• <strong>Seamless Auth:</strong> One login button, automatic action execution</li>
					<li>• <strong>No Redirects:</strong> Stay on current page after authentication</li>
				</ul>
			</div>
			
			<div class="mt-4 p-4 bg-blue-900 bg-opacity-30 border border-blue-500 rounded-2xl">
				<h4 class="text-lg font-bold text-blue-300 mb-2">🔧 For Developers</h4>
				<ul class="text-sm text-blue-200 space-y-1">
					<li>• QR codes generate SVG format for better quality</li>
					<li>• Download functionality with sanitized filenames</li>
					<li>• Debug mode active on localhost with console logging</li>
					<li>• All actions create proper data structures in holosphere</li>
				</ul>
			</div>
		</div>
	</div>
</div> 