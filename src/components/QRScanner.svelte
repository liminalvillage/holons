<script lang="ts">
    import { onDestroy, createEventDispatcher } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { Html5Qrcode } from 'html5-qrcode';

    const dispatch = createEventDispatcher<{
        scan: { decodedText: string };
        error: { message: string };
        close: void;
    }>();

    let scannerContainer: HTMLDivElement;
    let html5QrCode: Html5Qrcode | null = null;
    let isScanning = false;
    let error = '';
    export let showScanner = false;

    // Camera selection
    let useFrontCamera = false;
    $: facingMode = useFrontCamera ? "user" : "environment";
    
    $: if (showScanner && scannerContainer) {
        // When scanner becomes visible and container is ready, start scanning
        if (!isScanning) {
            startScanner();
        }
    } else if (!showScanner && isScanning) {
        // When scanner is hidden, stop scanning
        stopScanner();
    }

    function initializeScanner() {
        if (scannerContainer && !html5QrCode) {
            try {
                html5QrCode = new Html5Qrcode("qr-reader", {
                    verbose: false // Set to true for debugging
                });
                console.log('QR Scanner initialized successfully');
            } catch (err) {
                console.error('Failed to initialize QR scanner:', err);
                error = 'Failed to initialize scanner';
            }
        }
    }

    onDestroy(() => {
        if (html5QrCode && isScanning) {
            stopScanner();
        }
    });

    async function startScanner() {
        if (!scannerContainer) {
            // Defer until the container is available
            setTimeout(startScanner, 50);
            return;
        }

        if (!html5QrCode) {
            initializeScanner();
            if (!html5QrCode) { // If initialization failed
                return;
            }
        }

        if (isScanning) {
            return;
        }

        try {
            console.log('Starting QR scanner...');
            error = '';
            isScanning = true;

            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
            };

            const qrCodeSuccessCallback = (decodedText: string) => {
                console.log('QR Code detected:', decodedText);
                dispatch('scan', { decodedText });
                // Add a small delay to allow the scanner to finish processing
                // This prevents "Cannot transition to a new state" error
                setTimeout(() => {
                    stopScanner();
                    // Also dispatch close event to ensure parent knows to hide the scanner
                    dispatch('close');
                }, 100);
            };

            const qrCodeErrorCallback = (errorMessage: string) => {
                if (!errorMessage.includes('parse error') && !errorMessage.includes('NotFoundException') && !errorMessage.includes('No barcode or QR code detected')) {
                    console.log('QR scan error:', errorMessage);
                }
            };
            
            await html5QrCode.start(
                { facingMode: facingMode },
                config,
                qrCodeSuccessCallback,
                qrCodeErrorCallback
            );
            console.log('Camera started successfully');
        } catch (err) {
            console.error('Failed to start camera:', err);
            error = err instanceof Error ? err.message : 'Failed to start camera';
            isScanning = false;
        }
    }

    function stopScanner() {
        if (html5QrCode && isScanning) {
            html5QrCode.stop().then(() => {
                isScanning = false;
                console.log('QR Scanner stopped successfully');
            }).catch((err) => {
                console.error('Error stopping scanner:', err);
                isScanning = false;
            });
        } else {
            isScanning = false;
        }
    }

    function closeScanner() {
        console.log('Closing QR scanner...');
        stopScanner();
        // Reset error state
        error = '';
        // Set showScanner to false directly (works with bind:)
        showScanner = false;
        dispatch('close');
    }

    async function switchCamera() {
        if (!isScanning) return;

        try {
            // Stop current camera
            await html5QrCode?.stop();
            isScanning = false;

            // Toggle camera
            useFrontCamera = !useFrontCamera;

            // Small delay to ensure camera is released
            await new Promise(resolve => setTimeout(resolve, 100));

            // Start with new camera
            await startScanner();
        } catch (err) {
            console.error('Failed to switch camera:', err);
            error = 'Failed to switch camera. Try again.';
        }
    }
</script>

{#if showScanner}
    <div
        class="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]"
        transition:fade
        onclick={(e) => { if (e.target === e.currentTarget) closeScanner(); }}
        onkeydown={(e) => e.key === 'Escape' && closeScanner()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4"
            transition:scale
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            tabindex="-1"
        >
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">Scan QR Code</h3>
                <button
                    onclick={(e) => { e.stopPropagation(); closeScanner(); }}
                    class="p-2 bg-gray-700 hover:bg-red-600 text-white rounded-full transition-colors"
                    aria-label="Close QR scanner"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {#if error}
                <div class="mb-4 p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-400 text-sm">
                    {error}
                </div>
            {/if}

            <div class="space-y-4">
                <div class="relative w-64 h-64 mx-auto">
                    <div 
                        bind:this={scannerContainer}
                        id="qr-reader"
                        class="w-full h-full bg-black rounded-lg overflow-hidden relative"
                    >
                        <!-- Video will be inserted here by html5-qrcode -->
                    </div>
                    
                    <!-- Scanning overlay -->
                    {#if isScanning}
                        <div class="absolute inset-0 pointer-events-none z-20">
                            <div class="absolute inset-0 border-2 border-indigo-500 rounded-lg m-4">
                                <div class="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-indigo-500"></div>
                                <div class="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-indigo-500"></div>
                                <div class="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-indigo-500"></div>
                                <div class="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-indigo-500"></div>
                            </div>
                        </div>
                    {/if}
                </div>

                <div class="text-center text-sm text-gray-400">
                    <p>Position the QR code within the frame to scan</p>
                    <p class="text-xs mt-1">Best used on mobile devices with cameras</p>
                </div>

                <div class="flex gap-3">
                    {#if !isScanning}
                        <button
                            onclick={startScanner}
                            class="btn btn--primary flex-1"
                        >
                            Start Camera
                        </button>
                    {:else}
                        <button
                            onclick={stopScanner}
                            class="btn btn--danger flex-1"
                        >
                            Stop Camera
                        </button>
                    {/if}
                    {#if isScanning}
                        <button
                            onclick={switchCamera}
                            class="btn btn--secondary"
                            title="Switch Camera"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    {/if}
                    <button
                        onclick={closeScanner}
                        class="btn btn--secondary flex-1"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Custom styles for the QR scanner */
    #qr-reader {
        min-height: 256px;
        position: relative;
        background: black;
    }

    /* Mirror the video feed for better user experience */
    /* The camera preview should act like a mirror */
    :global(#qr-reader video) {
        transform: scaleX(-1);
        -webkit-transform: scaleX(-1);
    }
</style> 