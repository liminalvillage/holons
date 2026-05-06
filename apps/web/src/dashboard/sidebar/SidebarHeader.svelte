<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ID } from '../store';
	
	function navigateToHolons() {
		// Clear the current holon ID to prevent automatic redirect back to dashboard
		ID.set('');
		goto('/');
	}
</script>

<div class="bg-gray-900 flex items-center justify-center mb-6 pb-6 pt-3 sticky top-0 z-10">
	<!-- Logo removed as requested -->
</div>
