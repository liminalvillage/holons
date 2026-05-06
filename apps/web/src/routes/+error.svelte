<script lang="ts">
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';

    function goToDemo() {
        const demoHolonId = "demo123"; // Replace with your actual demo holon ID
        goto(`/${demoHolonId}/dashboard`);
    }
</script>

<div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
    <div class="text-center space-y-6 max-w-2xl">
        <h1 class="text-6xl font-bold text-white mb-4">
            {#if $page.status === 404}
                404 - Not Found
            {:else}
                {$page.status} - {$page.error?.message || 'Error'}
            {/if}
        </h1>
        
        <p class="text-xl text-gray-400 mb-8">
            {#if $page.status === 404}
                The holon you're looking for doesn't exist or might have been moved.
            {:else}
                Something went wrong. Please try again later.
            {/if}
        </p>

        <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <button
                class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                on:click={() => goToDemo()}
            >
                Try Demo Holon
            </button>
            
            <button
                class="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                on:click={() => window.history.back()}
            >
                Go Back
            </button>
        </div>

        <div class="mt-12 text-gray-500">
            <p>Need help? Check out our <a href="https://docs.holons.io" class="text-blue-400 hover:underline">documentation</a></p>
        </div>
    </div>

    <!-- Decorative background elements -->
    <div class="absolute inset-0 overflow-hidden -z-10">
        <div class="absolute w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -top-48 -left-48"></div>
        <div class="absolute w-96 h-96 bg-purple-500/10 rounded-full blur-3xl -bottom-48 -right-48"></div>
    </div>
</div> 