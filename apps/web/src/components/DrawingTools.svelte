<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    const dispatch = createEventDispatcher();

    export let drawingEnabled = false;
    export let currentTool = 'hand';
    export let currentColor = '#3B82F6';
    export let currentStroke = 3;

    // Drawing tools
    const tools = [
        { id: 'line', name: 'Line', icon: '📏' },
        { id: 'free', name: 'Draw', icon: '✒️' },
        { id: 'text', name: 'Text', icon: '📝' }
    ];

    const colors = [
        '#3B82F6', '#EF4444', '#10B981', '#F59E0B', 
        '#8B5CF6', '#F97316', '#06B6D4', '#84CC16'
    ];

    const strokeWidths = [1, 2, 3, 5, 8, 12];

    function toggleDrawing() {
        const newDrawingEnabled = !drawingEnabled;
        console.log('Toggle drawing:', { drawingEnabled: newDrawingEnabled, currentTool });
        
        let newCurrentTool = currentTool;
        if (!newDrawingEnabled) {
            newCurrentTool = 'hand'; // Switch to navigation mode
        } else {
            newCurrentTool = 'line'; // Default to line when entering drawing mode
        }
        
        console.log('After toggle:', { drawingEnabled: newDrawingEnabled, currentTool: newCurrentTool });
        
        dispatch('toggle', { 
            drawingEnabled: newDrawingEnabled, 
            currentTool: newCurrentTool 
        });
    }

    function selectTool(toolId: string) {
        dispatch('toolChange', { currentTool: toolId });
    }

    function selectColor(color: string) {
        dispatch('colorChange', { currentColor: color });
    }

    function selectStroke(stroke: number) {
        dispatch('strokeChange', { currentStroke: stroke });
    }

    function clearDrawings() {
        dispatch('clear');
    }
</script>

<!-- Drawing Tools Panel -->
<div class="absolute top-4 left-4 z-10 flex flex-col gap-2">
    <!-- Drawing Toggle -->
    <button 
        class="p-2 rounded-lg text-white transition-colors {drawingEnabled ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-800 bg-opacity-50 hover:bg-gray-700'}"
        on:click={toggleDrawing}
        title={drawingEnabled ? 'Exit drawing mode' : 'Enter drawing mode'}
    >
        {drawingEnabled ? '🎨' : '✏️'}
    </button>

    {#if drawingEnabled}
        <!-- Tools -->
        <div class="bg-gray-800 bg-opacity-90 rounded-lg p-2 border border-gray-600">
            <div class="text-white text-opacity-70 text-xs mb-2 text-center">Tools</div>
            <div class="flex flex-col gap-1">
                {#each tools as tool}
                    <button 
                        class="p-2 rounded text-sm transition-colors"
                        class:bg-blue-600={currentTool === tool.id}
                        class:bg-gray-700={currentTool !== tool.id}
                        class:text-white={currentTool === tool.id}
                        class:text-gray-300={currentTool !== tool.id}
                        on:click={() => selectTool(tool.id)}
                        title={tool.name}
                    >
                        {tool.icon}
                    </button>
                {/each}
            </div>
        </div>

        <!-- Colors -->
        <div class="bg-gray-800 bg-opacity-90 rounded-lg p-2 border border-gray-600">
            <div class="text-white text-opacity-70 text-xs mb-2 text-center">Colors</div>
            <div class="grid grid-cols-2 gap-1">
                {#each colors as color}
                    <button 
                        class="w-6 h-6 rounded border-2 transition-all"
                        class:border-white={currentColor === color}
                        class:border-gray-600={currentColor !== color}
                        style="background-color: {color};"
                        on:click={() => selectColor(color)}
                        title={color}
                        aria-label="Select {color} color"
                    ></button>
                {/each}
            </div>
        </div>

        <!-- Stroke Width -->
        <div class="bg-gray-800 bg-opacity-90 rounded-lg p-2 border border-gray-600">
            <div class="text-white text-opacity-70 text-xs mb-2 text-center">Size</div>
            <div class="flex flex-col gap-1">
                {#each strokeWidths as width}
                    <button 
                        class="p-1 rounded transition-colors flex items-center justify-center"
                        class:bg-blue-600={currentStroke === width}
                        class:bg-gray-700={currentStroke !== width}
                        on:click={() => selectStroke(width)}
                        title="{width}px"
                        aria-label="Select {width}px stroke width"
                    >
                        <div 
                            class="rounded-full bg-current"
                            style="width: {Math.min(width, 12)}px; height: {Math.min(width, 12)}px;"
                        ></div>
                    </button>
                {/each}
            </div>
        </div>

        <!-- Clear -->
        <button 
            class="p-2 bg-red-800 bg-opacity-70 hover:bg-red-700 rounded-lg text-white text-opacity-90 hover:text-white transition-colors"
            on:click={clearDrawings}
            title="Clear all drawings"
        >
            🗑️
        </button>
    {/if}
</div> 