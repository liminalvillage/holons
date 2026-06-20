<script lang="ts">
    import { createEventDispatcher, getContext, onMount, afterUpdate, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import type { HoloSphere } from 'holosphere';
    import DrawingTools from './DrawingTools.svelte';
    import TaskCard from './shared/TaskCard.svelte';
    import { fileToDownscaledDataURL } from '../utils/imageCompression';

    const holosphere = getContext("holosphere") as HoloSphere;

    export let filteredQuests: [string, any][] = [];
    export let holonID: string;
    export let showCompleted: boolean = false;
    // The canvas this view persists to. Defaults to the holon-level canvas
    // (canvasId = holonID). Task canvases pass an explicit canvasId.
    export let canvasId: string | undefined = undefined;
    // 'tasks' (default) renders the embedded spatial-task layer on top of the
    // canvas. 'standalone' renders only the drawing/image layer — used by the
    // /[id]/canvas[/canvasId] routes.
    export let mode: 'tasks' | 'standalone' = 'tasks';

    $: effectiveCanvasId = canvasId ?? holonID;
    $: isStandalone = mode === 'standalone';

    const dispatch = createEventDispatcher();
    let canvas: HTMLElement;
    let container: HTMLElement;
    let viewContainer: HTMLElement;
    let isDragging = false;
    let draggedCard: { key: string; quest: any; x: number; y: number; } | null = null;
    let offset = { x: 0, y: 0 };
    let zoom = 1;
    // Zoom range. The very low minimum lets you zoom all the way out to frame
    // the whole board / every card ("full scope"), even when cards are spread
    // far apart; see zoomToFit().
    const MIN_ZOOM = 0.05;
    const MAX_ZOOM = 2;
    let pan = { x: 0, y: 0 };
    let startPan = { x: 0, y: 0 };
    let isPanning = false;
    let draggedCardVisuals: { key: string; x: number; y: number } | null = null;
    let dragStartPosition = { x: 0, y: 0 };
    let isMovingDrawing = false;
    let selectedDrawingIndex: number | null = null;
    let lastMovePoint = { x: 0, y: 0 };



    // Smaller, more manageable canvas with 0,0 at top-left
    const CANVAS_WIDTH = 8000;
    const CANVAS_HEIGHT = 6000;
    const INITIAL_OFFSET = { x: 0, y: 0 };
    
    // New task inbox area
    const INBOX_CENTER = { x: 200, y: 200 };
    const INBOX_WIDTH = 400;
    const INBOX_HEIGHT = 300;

    // Drawing tools state
    let isDrawing = false;
    let drawingEnabled = false;
    let currentTool = 'hand';
    let currentColor = '#3B82F6';
    let currentStroke = 3;
    let drawings: any[] = [];
    let drawingsUpdatedAt = 0; // track last update timestamp
    let currentPath: any[] = [];
    let startPoint: { x: number; y: number } | null = null;
    let isEditingText = false;
    let textInput = '';
    let textPosition: { x: number; y: number } | null = null;
    let currentFontFamily = 'sans-serif';

    // Image resize state
    let isResizingImage = false;
    let resizeHandle: 'nw' | 'ne' | 'sw' | 'se' | null = null;
    let resizeStartRect: { x: number; y: number; width: number; height: number } | null = null;
    let resizeStartPoint: { x: number; y: number } | null = null;
    let resizeKeepAspect = false;
    // Type-specific snapshot of the selected drawing taken when resize begins,
    // so non-image scaling can recompute from a stable baseline instead of
    // accumulating per-frame.
    let resizeStartMeta: any = null;
    let isDraggingFiles = false;

    // Image rotation state
    let isRotatingImage = false;
    let rotateStartAngle = 0;
    let rotateStartRotation = 0;
    let rotateCenter: { x: number; y: number } | null = null;

    let textInputEl: HTMLInputElement | null = null;

    // Web-safe + commonly-installed fonts surfaced in the text selection font picker.
    const FONT_OPTIONS = [
        { label: 'Sans', value: 'sans-serif' },
        { label: 'Serif', value: 'serif' },
        { label: 'Mono', value: 'monospace' },
        { label: 'Georgia', value: 'Georgia, serif' },
        { label: 'Times', value: '"Times New Roman", Times, serif' },
        { label: 'Courier', value: '"Courier New", Courier, monospace' },
        { label: 'Comic', value: '"Comic Sans MS", "Comic Sans", cursive' },
        { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
    ];

    // Diagonal drag distance (px, post-pan/zoom canvas coords) that produces
    // a 1.0 → 2.0 size change for non-image drawings. Larger = slower / more
    // controlled scaling. Used by the linear, opposite-corner-anchored scale
    // applied to text/line/path so a 16px font doesn't explode the way a
    // proportional bbox-fit would.
    const NONIMAGE_RESIZE_REFERENCE = 250;

    // The canvas is "editable" (select / move / resize / rotate / delete
    // existing drawings) when the user is either in drawing mode or viewing
    // the canvas standalone. Standalone has no task cards to interact with,
    // so it always behaves like an edit view.
    $: canEditCanvas = drawingEnabled || isStandalone;



    // Initialize positions if not set - move this out of the reactive statement
    let questCards: { key: string; quest: any; x: number; y: number; }[] = [];
    let positionAssignments = new Set<string>(); // Track which quests have been assigned positions
    let pendingPositionSaves = new Map<string, { x: number; y: number }>(); // Track pending saves
    let hologramPositions = new Map<string, { x: number; y: number }>(); // Local storage for hologram positions
    let generatedInboxPositions = new Map<string, { x: number; y: number }>(); // Cache for generated inbox positions

    const CARD_WIDTH = 320; // Based on w-80 class (20rem * 16px/rem)
    const CARD_HEIGHT_ESTIMATE = CARD_WIDTH; // canvas cards are square (see TaskCardShell)

    // Track card DOM elements and measure viewport-relative positions
    let cardElements = new Map<string, HTMLElement>();
    let measuredCardRects = new Map<string, { x:number; y:number; width:number; height:number }>();

    function registerCardElement(cardKey: string, element: HTMLElement | null) {
        if (element) {
            cardElements.set(cardKey, element);
        } else {
            cardElements.delete(cardKey);
        }
        // Force reactivity on the map for Svelte
        cardElements = new Map(cardElements);
    }

    // Svelte action to track card elements
    function trackCardElement(node: HTMLElement, cardKey: string) {
        registerCardElement(cardKey, node);
        return {
            update(newKey: string) {
                if (newKey !== cardKey) {
                    registerCardElement(cardKey, null);
                    registerCardElement(newKey, node);
                }
            },
            destroy() {
                registerCardElement(cardKey, null);
            }
        };
    }

    // Get measured DOM position of a card relative to the viewport container
    function getCardPosition(cardKey: string): { x: number; y: number; width: number; height: number } | null {
        const cached = measuredCardRects.get(cardKey);
        if (cached) return cached;
        return null;
    }

    // Point on a rectangle's border along the ray from its centre toward
    // (targetX, targetY). Used to anchor dependency arrows edge-to-edge: each
    // end leaves/lands on the side of the card that faces the other card, so
    // the arrow always takes the shortest path between the two rectangles
    // regardless of their relative position (left/right/above/below).
    function borderPoint(
        rectX: number,
        rectY: number,
        width: number,
        height: number,
        targetX: number,
        targetY: number,
    ): { x: number; y: number } {
        const cx = rectX + width / 2;
        const cy = rectY + height / 2;
        const dx = targetX - cx;
        const dy = targetY - cy;
        if (dx === 0 && dy === 0) return { x: cx, y: cy };
        // Scale the centre→target vector until it hits the nearest edge; the
        // smaller of the horizontal/vertical scales is the one that wins.
        const scaleX = dx !== 0 ? width / 2 / Math.abs(dx) : Infinity;
        const scaleY = dy !== 0 ? height / 2 / Math.abs(dy) : Infinity;
        const scale = Math.min(scaleX, scaleY);
        return { x: cx + dx * scale, y: cy + dy * scale };
    }



    // Measure positions of all known cards after each paint so arrows stay in sync with pan/zoom/drag
    afterUpdate(() => {
        if (!viewContainer) return;
        const containerRect = viewContainer.getBoundingClientRect();
        const newRects = new Map<string, { x:number; y:number; width:number; height:number }>();
        cardElements.forEach((el, key) => {
            const r = el.getBoundingClientRect();
            newRects.set(key, {
                x: r.left - containerRect.left,
                y: r.top - containerRect.top,
                width: r.width,
                height: r.height
            });
        });
        measuredCardRects = newRects; // trigger reactivity
    });

    // Clear position tracking when holonID changes and load hologram positions
    $: if (holonID) {
        positionAssignments.clear();
        pendingPositionSaves.clear();
        generatedInboxPositions.clear(); // Clear cached inbox positions for new holon

        // Load hologram positions from localStorage
        try {
            const stored = localStorage.getItem(`hologramPositions_${holonID}`);
            if (stored) {
                const parsed = JSON.parse(stored);
                hologramPositions = new Map(Object.entries(parsed));
            } else {
                hologramPositions.clear();
            }
        } catch (error) {
            console.error('Error loading hologram positions:', error);
            hologramPositions.clear();
        }
    }

    // Re-load drawings whenever the canvas being viewed changes.
    $: if (holonID && effectiveCanvasId) {
        loadDrawings();
    }
    
    // Save hologram positions to localStorage when they change
    function saveHologramPositions() {
        if (holonID && hologramPositions.size > 0) {
            try {
                const obj = Object.fromEntries(hologramPositions);
                localStorage.setItem(`hologramPositions_${holonID}`, JSON.stringify(obj));
            } catch (error) {
                console.error('Error saving hologram positions:', error);
            }
        }
    }

    // Drawing functions
    async function loadDrawings() {
        if (!holosphere || !holonID) return;
        const cid = effectiveCanvasId;
        try {
            const entry = await holosphere.get(holonID, 'canvases', cid);
            if (entry && entry.data && Array.isArray(entry.data)) {
                drawings = entry.data;
                drawingsUpdatedAt = entry.updatedAt || 0;
                return;
            }

            // Back-compat: the holon canvas used to live at
            // (holonID, 'canvas', 'drawings'). On first read of the new
            // 'canvases' lens for the holon canvas, migrate from the old
            // location so existing drawings don't disappear.
            if (cid === holonID) {
                const legacy = await holosphere.get(holonID, 'canvas', 'drawings');
                if (legacy && legacy.data && Array.isArray(legacy.data)) {
                    drawings = legacy.data;
                    drawingsUpdatedAt = legacy.updatedAt || Date.now();
                    // Mirror into the new lens so future reads skip the legacy path.
                    holosphere.put(holonID, 'canvases', { id: cid, data: drawings, updatedAt: drawingsUpdatedAt })
                        .catch((err: unknown) => console.error('Error migrating legacy canvas drawings:', err));
                    return;
                }
                if (Array.isArray(legacy)) {
                    drawings = legacy;
                    drawingsUpdatedAt = Date.now();
                    return;
                }
            }

            drawings = [];
        } catch (error) {
            console.error('Error loading drawings:', error);
            drawings = [];
        }
    }

    async function saveDrawings() {
        if (!holosphere || !holonID) return;
        const cid = effectiveCanvasId;
        drawingsUpdatedAt = Date.now();
        try {
            await holosphere.put(holonID, 'canvases', { id: cid, data: drawings, updatedAt: drawingsUpdatedAt });
        } catch (error) {
            console.error('Error saving drawings:', error);
        }
    }

    function toggleDrawing() {
        drawingEnabled = !drawingEnabled;
        console.log('Toggle drawing:', { drawingEnabled, currentTool });
        if (!drawingEnabled) {
            isDrawing = false;
            currentPath = [];
            startPoint = null;
            isEditingText = false;
            textPosition = null;
            currentTool = 'hand'; // Switch to navigation mode
        } else {
            currentTool = 'line'; // Default to line when entering drawing mode
        }
        console.log('After toggle:', { drawingEnabled, currentTool });
    }

    // Event handlers for DrawingTools component
    function handleDrawingToggle(event: CustomEvent) {
        const { drawingEnabled: newDrawingEnabled, currentTool: newCurrentTool } = event.detail;
        drawingEnabled = newDrawingEnabled;
        currentTool = newCurrentTool;
        
        if (!drawingEnabled) {
            isDrawing = false;
            currentPath = [];
            startPoint = null;
            isEditingText = false;
            textPosition = null;
        }
    }

    function handleToolChange(event: CustomEvent) {
        const { currentTool: newCurrentTool } = event.detail;
        currentTool = newCurrentTool;
    }

    function handleColorChange(event: CustomEvent) {
        const { currentColor: newCurrentColor } = event.detail;
        currentColor = newCurrentColor;
    }

    function handleStrokeChange(event: CustomEvent) {
        const { currentStroke: newCurrentStroke } = event.detail;
        currentStroke = newCurrentStroke;
    }

    function clearDrawings() {
        drawings = [];
        saveDrawings();
    }

    function handleTextInput(event: KeyboardEvent) {
        if (event.key === 'Enter' && textInput.trim() && textPosition) {
            // Save the text
            drawings = [...drawings, {
                type: 'text',
                text: textInput.trim(),
                x: textPosition.x,
                y: textPosition.y,
                color: currentColor,
                fontSize: currentStroke * 4, // Use stroke width as font size multiplier
                fontFamily: currentFontFamily,
                timestamp: Date.now()
            }];
            console.log('Saved text:', textInput, 'at:', textPosition);
            saveDrawings();
            
            // Reset text state
            isEditingText = false;
            textInput = '';
            textPosition = null;
        } else if (event.key === 'Escape') {
            // Cancel text input
            isEditingText = false;
            textInput = '';
            textPosition = null;
        }
    }

    function getCanvasPoint(clientX: number, clientY: number) {
        if (!viewContainer) return { x: 0, y: 0 };
        const rect = viewContainer.getBoundingClientRect();
        return {
            x: (clientX - rect.left - pan.x) / zoom,
            y: (clientY - rect.top - pan.y) / zoom
        };
    }

    // Minimap functions
    const MINIMAP_WIDTH = 120;
    const MINIMAP_HEIGHT = 90;

    // Reactive minimap calculations that update when zoom, pan, or viewContainer changes
    let minimapViewX = 0;
    let minimapViewY = 0;
    let minimapViewWidth = MINIMAP_WIDTH;
    let minimapViewHeight = MINIMAP_HEIGHT;

    // The drawing canvas is a fixed 8000x6000, but task cards usually cluster
    // near the origin (the inbox sits around 200,200). Mapping card coordinates
    // against the full canvas crams every dot into the minimap's top-left
    // corner. Instead, fit the bounding box of the actual cards into the minimap
    // with a single uniform scale, so the dots mirror the on-screen layout.
    $: minimapTransform = (() => {
        const PAD = 400; // canvas-px breathing room around the content
        const MIN_SPAN_X = 1600; // floor on span so a lone card isn't blown up
        const MIN_SPAN_Y = 1200; // (4:3 to match the 120x90 minimap)

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const card of questCards) {
            minX = Math.min(minX, card.x);
            minY = Math.min(minY, card.y);
            maxX = Math.max(maxX, card.x + CARD_WIDTH);
            maxY = Math.max(maxY, card.y + CARD_HEIGHT_ESTIMATE);
        }
        if (!isFinite(minX)) {
            // No cards yet: center on the inbox area.
            minX = maxX = INBOX_CENTER.x;
            minY = maxY = INBOX_CENTER.y;
        }

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const spanX = Math.max(maxX - minX + PAD * 2, MIN_SPAN_X);
        const spanY = Math.max(maxY - minY + PAD * 2, MIN_SPAN_Y);

        // Uniform scale preserves aspect ratio; offsets center it in the box.
        const scale = Math.min(MINIMAP_WIDTH / spanX, MINIMAP_HEIGHT / spanY);
        return {
            minX: cx - spanX / 2,
            minY: cy - spanY / 2,
            scale,
            offsetX: (MINIMAP_WIDTH - spanX * scale) / 2,
            offsetY: (MINIMAP_HEIGHT - spanY * scale) / 2
        };
    })();

    $: if (viewContainer && typeof window !== 'undefined' && minimapTransform) {
        const containerRect = viewContainer.getBoundingClientRect();
        
        // Calculate the visible area in canvas coordinates
        // The canvas transform is translate(pan.x, pan.y) scale(zoom)
        // So a screen point (0, 0) maps to canvas point (-pan.x/zoom, -pan.y/zoom)
        const visibleLeft = -pan.x / zoom;
        const visibleTop = -pan.y / zoom;
        const visibleRight = visibleLeft + (containerRect.width / zoom);
        const visibleBottom = visibleTop + (containerRect.height / zoom);
        const visibleWidth = containerRect.width / zoom;
        const visibleHeight = containerRect.height / zoom;
        
        // Convert to minimap coordinates using the same fitted transform as the dots
        const viewX = minimapTransform.offsetX + (visibleLeft - minimapTransform.minX) * minimapTransform.scale;
        const viewY = minimapTransform.offsetY + (visibleTop - minimapTransform.minY) * minimapTransform.scale;
        const viewWidth = visibleWidth * minimapTransform.scale;
        const viewHeight = visibleHeight * minimapTransform.scale;
        
        // Update reactive variables
        minimapViewX = Math.max(0, Math.min(MINIMAP_WIDTH - viewWidth, viewX));
        minimapViewY = Math.max(0, Math.min(MINIMAP_HEIGHT - viewHeight, viewY));
        minimapViewWidth = Math.min(MINIMAP_WIDTH, Math.max(5, viewWidth));
        minimapViewHeight = Math.min(MINIMAP_HEIGHT, Math.max(5, viewHeight));
        

    }

    function handleMinimapClick(event: MouseEvent) {
        event.stopPropagation();
        if (!viewContainer) return;

        const minimapRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const clickX = event.clientX - minimapRect.left;
        const clickY = event.clientY - minimapRect.top;

        // Convert minimap coordinates to canvas coordinates (inverse of the fitted transform)
        const canvasX = minimapTransform.minX + (clickX - minimapTransform.offsetX) / minimapTransform.scale;
        const canvasY = minimapTransform.minY + (clickY - minimapTransform.offsetY) / minimapTransform.scale;

        // Center the view on the clicked point
        const containerRect = viewContainer.getBoundingClientRect();
        pan = {
            x: -(canvasX * zoom) + containerRect.width / 2,
            y: -(canvasY * zoom) + containerRect.height / 2
        };


    }



    // questCards is now purely derived from filteredQuests.
    // This ensures it always reflects the latest positions from props when not actively dragging.
    $: questCards = filteredQuests
        .filter(([_, quest]) => showCompleted || quest.status !== 'completed')
        .map(([key, quest]) => {
            // Check if position exists
            if (quest.position && quest.position.x !== undefined && quest.position.y !== undefined) {
                // Use existing position
                positionAssignments.add(key); // Mark as having a position
                return {
                    key,
                    quest,
                    x: quest.position.x,
                    y: quest.position.y
                };
            }
            
            // For holograms, check if we have a locally stored position
            if (quest._hologram?.isHologram) {
                const hologramPosition = hologramPositions.get(key);
                if (hologramPosition) {
                    positionAssignments.add(key);
                    return {
                        key,
                        quest: { ...quest, position: hologramPosition },
                        x: hologramPosition.x,
                        y: hologramPosition.y
                    };
                }
            }
            
            // Check if we have a pending position save
            const pendingPosition = pendingPositionSaves.get(key);
            if (pendingPosition) {
                return {
                    key,
                    quest: { ...quest, position: pendingPosition },
                    x: pendingPosition.x,
                    y: pendingPosition.y
                };
            }
            
            // Check if we have a cached generated inbox position
            let inboxPosition = generatedInboxPositions.get(key);
            if (!inboxPosition) {
                // Generate consistent position within the inbox area for new tasks
                const hash = key.split('').reduce((a, b) => {
                    a = ((a << 5) - a) + b.charCodeAt(0);
                    return a & a;
                }, 0);
                
                // Position new tasks within the inbox area
                inboxPosition = {
                    x: INBOX_CENTER.x + (Math.sin(hash) * (INBOX_WIDTH / 3)),
                    y: INBOX_CENTER.y + (Math.cos(hash) * (INBOX_HEIGHT / 3))
                };
                
                // Cache the generated position to prevent regeneration
                generatedInboxPositions.set(key, inboxPosition);
            }
            
            return {
                key,
                quest,
                x: inboxPosition.x,
                y: inboxPosition.y
            };
        });

    function handleMouseDown(event: MouseEvent, card: typeof questCards[0] | null = null) {
        event.preventDefault();
        event.stopPropagation();

        dragStartPosition = { x: event.clientX, y: event.clientY };

        // Resize / rotate handles take priority whenever the canvas is editable.
        if (canEditCanvas && event.button === 0) {
            const target = event.target as HTMLElement | null;
            const handleEl = target?.closest?.('.image-resize-handle') as HTMLElement | null;
            if (handleEl) {
                const handle = handleEl.getAttribute('data-handle') as 'nw' | 'ne' | 'sw' | 'se' | null;
                if (handle) {
                    beginSelectionResize(event, handle);
                    return;
                }
            }
            const rotEl = target?.closest?.('.image-rotate-handle') as HTMLElement | null;
            if (rotEl) {
                beginSelectionRotate(event);
                return;
            }
            // Clicks on the floating action bar should not start a selection.
            if (target?.closest?.('.canvas-action-bar')) {
                return;
            }
        }

        // Selecting/moving existing drawings — works in drawing mode OR in
        // standalone view (no task cards to fight over the click).
        if (canEditCanvas && event.button === 0 && (!drawingEnabled || currentTool === 'hand')) {
            const point = getCanvasPoint(event.clientX, event.clientY);
            const idx = hitTestDrawing(point);
            if (idx !== null) {
                isMovingDrawing = true;
                selectedDrawingIndex = idx;
                lastMovePoint = { ...point };
                return;
            } else if (drawingEnabled && currentTool === 'hand') {
                // In drawing mode, clicking empty space deselects.
                selectedDrawingIndex = null;
            } else if (isStandalone && !drawingEnabled) {
                // In standalone mode, clicking empty space deselects but
                // also falls through to panning below.
                selectedDrawingIndex = null;
            }
        }

        // Handle drawing mode - disable all other interactions
        if (drawingEnabled && event.button === 0) {
            const point = getCanvasPoint(event.clientX, event.clientY);

            if (currentTool === 'hand') {
                // Hit-test was already performed above; fall through to no-op.
                return;
            }

            if (currentTool === 'line') {
                isDrawing = true;
                startPoint = { x: point.x, y: point.y };
            } else if (currentTool === 'free') {
                isDrawing = true;
                currentPath = [{ x: point.x, y: point.y }];
            } else if (currentTool === 'text') {
                // Place text at clicked position
                textPosition = { x: point.x, y: point.y };
                isEditingText = true;
                textInput = '';
            } else if (currentTool === 'eraser') {
                isDrawing = true;
                // Find and remove drawings at this point
                const eraseRadius = currentStroke * 2;
                drawings = drawings.filter(drawing => {
                    if (drawing.type === 'path' || drawing.type === 'line') {
                        return !drawing.points?.some((p: any) =>
                            Math.hypot(p.x - point.x, p.y - point.y) < eraseRadius
                        );
                    } else if (drawing.type === 'text') {
                        return Math.hypot(drawing.x - point.x, drawing.y - point.y) > eraseRadius;
                    } else if (drawing.type === 'image') {
                        // Erase an image when the point falls inside its bounding box.
                        return !(point.x >= drawing.x && point.x <= drawing.x + drawing.width
                            && point.y >= drawing.y && point.y <= drawing.y + drawing.height);
                    }
                    return true;
                });
            }
            return; // Exit early, don't allow panning or card dragging
        }
        
        // Only allow panning and card dragging when drawing is disabled
        if (!drawingEnabled) {
            if (event.button === 1 || event.button === 2 || !card) {
                isPanning = true;
                startPan = { 
                    x: event.clientX - pan.x, 
                    y: event.clientY - pan.y 
                };
                return;
            }

            if (event.button === 0 && card) {
                isDragging = true;
                draggedCard = card;
                draggedCardVisuals = { key: card.key, x: card.x, y: card.y };
                
                const rect = canvas.getBoundingClientRect();
                const mouseX = (event.clientX - rect.left - pan.x) / zoom;
                const mouseY = (event.clientY - rect.top - pan.y) / zoom;
                
                offset = {
                    x: mouseX - card.x,
                    y: mouseY - card.y
                };
            }
        }
    }

    function handleMouseMove(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        // Image resize / rotate take precedence.
        if (canEditCanvas && isResizingImage) {
            applySelectionResize(event);
            return;
        }
        if (canEditCanvas && isRotatingImage) {
            applySelectionRotate(event);
            return;
        }

        // Move the currently selected drawing.
        if (canEditCanvas && isMovingDrawing && selectedDrawingIndex!==null) {
            const point = getCanvasPoint(event.clientX, event.clientY);
            const deltaX = point.x - lastMovePoint.x;
            const deltaY = point.y - lastMovePoint.y;
            if (deltaX===0 && deltaY===0) return;
            const d = drawings[selectedDrawingIndex];
            if (d.type === 'text' || d.type === 'image') {
                d.x += deltaX;
                d.y += deltaY;
            } else if (d.type==='line' && d.points?.length===2) {
                d.points.forEach((p:any)=>{p.x+=deltaX; p.y+=deltaY;});
            } else if (d.type==='path' && d.points?.length>0) {
                d.points.forEach((p:any)=>{p.x+=deltaX; p.y+=deltaY;});
            }
            lastMovePoint = point;
            drawings = drawings;
            return;
        }
        
        if (drawingEnabled && isDrawing) {
            const point = getCanvasPoint(event.clientX, event.clientY);
            
            if (currentTool === 'line' && startPoint) {
                // Update the preview line endpoint
                currentPath = [startPoint, { x: point.x, y: point.y }];
            } else if (currentTool === 'free' && isDrawing) {
                // Append points for free draw
                currentPath.push({ x: point.x, y: point.y });
            } else if (currentTool === 'eraser') {
                // Continue erasing
                const eraseRadius = currentStroke * 2;
                drawings = drawings.filter(drawing => {
                    if (drawing.type === 'path' || drawing.type === 'line') {
                        return !drawing.points?.some((p: any) =>
                            Math.hypot(p.x - point.x, p.y - point.y) < eraseRadius
                        );
                    } else if (drawing.type === 'text') {
                        return Math.hypot(drawing.x - point.x, drawing.y - point.y) > eraseRadius;
                    } else if (drawing.type === 'image') {
                        // Erase an image when the point falls inside its bounding box.
                        return !(point.x >= drawing.x && point.x <= drawing.x + drawing.width
                            && point.y >= drawing.y && point.y <= drawing.y + drawing.height);
                    }
                    return true;
                });
            }
            return;
        }
        
        // Only allow panning and card dragging when drawing is disabled
        if (!drawingEnabled) {
            if (isPanning && viewContainer) {
                const newPan = {
                    x: (event.clientX - startPan.x),
                    y: (event.clientY - startPan.y)
                };
                
                // Remove Panning Constraints
                pan = newPan;
                return;
            }

            if (!isDragging || !draggedCardVisuals || !canvas) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX = (event.clientX - rect.left - pan.x) / zoom;
            const mouseY = (event.clientY - rect.top - pan.y) / zoom;
            const newX = mouseX - offset.x;
            const newY = mouseY - offset.y;

            // Remove card position constraints
            draggedCardVisuals.x = newX;
            draggedCardVisuals.y = newY;
        }
    }

    function handleMouseUp(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        // Finish an in-progress image resize / rotate.
        if (canEditCanvas && isResizingImage) {
            endSelectionResize();
            return;
        }
        if (canEditCanvas && isRotatingImage) {
            endSelectionRotate();
            return;
        }

        // End drag-move of a selected drawing.
        if (canEditCanvas && isMovingDrawing) {
            isMovingDrawing = false;
            // Keep selection sticky so the user can resize / rotate / delete next.
            saveDrawings();
            return;
        }
        
        if (drawingEnabled && isDrawing) {
            isDrawing = false;
            
            if (currentTool === 'line' && currentPath.length === 2) {
                // Save the completed line
                const newDrawing = {
                    type: 'line',
                    points: currentPath,
                    color: currentColor,
                    strokeWidth: currentStroke,
                    timestamp: Date.now()
                };
                drawings = [...drawings, newDrawing];
                saveDrawings();
            } else if (currentTool === 'free' && currentPath.length > 1) {
                drawings = [...drawings, {
                    type: 'path',
                    points: currentPath,
                    color: currentColor,
                    strokeWidth: currentStroke,
                    timestamp: Date.now()
                }];
                saveDrawings();
            }
            
            currentPath = [];
            startPoint = null;
            return;
        }
        
        // Handle task clicks and dragging
        const wasDragging = isDragging;
        const wasPanning = isPanning;
        // Use draggedCard (original data) and draggedCardVisuals (final position)
        const finalDraggedCardData = draggedCard; 
        const finalVisualPosition = draggedCardVisuals;
        
        // Reset states first
        isDragging = false;
        draggedCard = null;
        draggedCardVisuals = null; // Reset visual state
        isPanning = false;
        
        // Handle task interactions (works regardless of drawing mode)
        if (wasDragging && finalDraggedCardData && finalVisualPosition && holonID) {
            const newPosition = { x: finalVisualPosition.x, y: finalVisualPosition.y };

            const dx = Math.abs(newPosition.x - finalDraggedCardData.x);
            const dy = Math.abs(newPosition.y - finalDraggedCardData.y);
            const moveThreshold = 5; // pixels

            // Check if it was a click (not a drag)
            if (dx < moveThreshold && dy < moveThreshold) {
                dispatch('taskClick', {
                    key: finalDraggedCardData.key,
                    quest: finalDraggedCardData.quest
                });
            } else if (!drawingEnabled) {
                // Only allow dragging tasks when drawing is disabled
                // Always save position when dragged (whether it had a position before or not)
                positionAssignments.add(finalDraggedCardData.key);
                pendingPositionSaves.set(finalDraggedCardData.key, newPosition);
                
                // Clear generated inbox position since we now have a real position
                generatedInboxPositions.delete(finalDraggedCardData.key);
                
                // Check if this is a hologram task (read-only from another holon)
                if (finalDraggedCardData.quest._hologram?.isHologram) {
                    // For holograms, we store the position locally in localStorage
                    hologramPositions.set(finalDraggedCardData.key, newPosition);
                    saveHologramPositions();
                    pendingPositionSaves.delete(finalDraggedCardData.key);
                    // Also clear from generated positions cache
                    generatedInboxPositions.delete(finalDraggedCardData.key);
                } else {
                    // Regular task - save to holosphere database
                    const updatedQuest = { 
                        ...finalDraggedCardData.quest,
                        id: finalDraggedCardData.key,
                        position: newPosition 
                    };
                    
                    // Dispatch optimistic update to parent
                    dispatch('questPositionChanged', {
                        key: finalDraggedCardData.key,
                        position: newPosition
                    });
                    
                    holosphere.put(holonID, 'quests', updatedQuest)
                        .then(() => {
                            pendingPositionSaves.delete(finalDraggedCardData.key);
                        })
                        .catch(error => {
                            console.error('Error updating quest position:', error);
                            // Revert tracking on error
                            positionAssignments.delete(finalDraggedCardData.key);
                            pendingPositionSaves.delete(finalDraggedCardData.key);
                                                  });
                }
            }
        }

        // Handle panning (only when drawing is disabled)
        if (wasPanning && !drawingEnabled) {
            // Panning was active, no special handling needed - already reset above
        }
    }

    // Add these state variables at the top
    let targetZoom = zoom;
    let lastMouseX = 0;
    let lastMouseY = 0;

    function handleWheel(event: WheelEvent) {
        // Only allow wheel zoom/pan when drawing is disabled
        if (drawingEnabled) return;
        
        event.preventDefault();
        
        if (event.ctrlKey || event.metaKey) {
            // Store mouse position relative to canvas
            const rect = viewContainer.getBoundingClientRect();
            lastMouseX = event.clientX - rect.left;
            lastMouseY = event.clientY - rect.top;

            // Calculate the point on canvas under mouse BEFORE zoom
            const canvasX = (lastMouseX - pan.x) / zoom;
            const canvasY = (lastMouseY - pan.y) / zoom;

            // Update zoom
            const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
            zoom = Math.min(Math.max(MIN_ZOOM, zoom * zoomFactor), MAX_ZOOM);

            // Calculate new pan to keep the same canvas point under mouse
            pan = {
                x: lastMouseX - (canvasX * zoom),
                y: lastMouseY - (canvasY * zoom)
            };

            // Remove Panning constraints for zoom
            // const rect2 = viewContainer.getBoundingClientRect();
            // pan = {
            //     x: Math.min(Math.max(pan.x, -CANVAS_WIDTH * zoom + rect2.width), 0),
            //     y: Math.min(Math.max(pan.y, -CANVAS_HEIGHT * zoom + rect2.height), 0)
            // };
        } else {
            // Simple panning - Remove Panning constraints
            pan = {
                x: pan.x - event.deltaX,
                y: pan.y - event.deltaY
            };
        }
    }

    // Add this to handle fullscreen toggle
    let isFullscreen = false;

    function requestFullscreen(element: HTMLElement) {
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if ((element as any).webkitRequestFullscreen) {
            (element as any).webkitRequestFullscreen(); // Safari
        } else if ((element as any).msRequestFullscreen) {
            (element as any).msRequestFullscreen(); // IE11
        }
    }

    function exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
            (document as any).webkitExitFullscreen(); // Safari
        } else if ((document as any).msExitFullscreen) {
            (document as any).msExitFullscreen(); // IE11
        }
    }

    function toggleFullscreen() {
        isFullscreen = !isFullscreen;
        if (isFullscreen) {
            requestFullscreen(viewContainer);
        } else {
            exitFullscreen();
        }
    }

    function goToInbox() {
        if (!viewContainer) return;
        
        // Navigate directly to the inbox area
        const containerRect = viewContainer.getBoundingClientRect();
        pan = {
            x: -(INBOX_CENTER.x * zoom) + containerRect.width / 2,
            y: -(INBOX_CENTER.y * zoom) + containerRect.height / 2
        };
        
    }

    function centerOnTasks() {
        if (!viewContainer) return;
        
        if (questCards.length === 0) {
            // No tasks, center on inbox
            goToInbox();
            return;
        }
        
        // Calculate the center of all tasks plus the inbox area
        let totalX = INBOX_CENTER.x; // Include inbox in calculation
        let totalY = INBOX_CENTER.y;
        questCards.forEach(card => {
            totalX += card.x;
            totalY += card.y;
        });
        
        const centerX = totalX / (questCards.length + 1); // +1 for inbox
        const centerY = totalY / (questCards.length + 1);

        // Center the view on the calculated center
        const containerRect = viewContainer.getBoundingClientRect();
        pan = {
            x: -(centerX * zoom) + containerRect.width / 2,
            y: -(centerY * zoom) + containerRect.height / 2
        };
    }

    // Zoom + pan so every card fits in view at once ("full scope"). Frames the
    // bounding box of all cards (plus padding) and centres it.
    function zoomToFit() {
        if (!viewContainer) return;
        if (questCards.length === 0) {
            zoom = 1;
            goToInbox();
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const card of questCards) {
            minX = Math.min(minX, card.x);
            minY = Math.min(minY, card.y);
            maxX = Math.max(maxX, card.x + CARD_WIDTH);
            maxY = Math.max(maxY, card.y + CARD_HEIGHT_ESTIMATE);
        }

        const PAD = 120; // canvas-px breathing room around the content
        minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;

        const rect = viewContainer.getBoundingClientRect();
        const contentW = Math.max(1, maxX - minX);
        const contentH = Math.max(1, maxY - minY);
        zoom = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, Math.min(rect.width / contentW, rect.height / contentH)),
        );

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        pan = {
            x: -(cx * zoom) + rect.width / 2,
            y: -(cy * zoom) + rect.height / 2,
        };
    }

    // Persist one card's computed position the same way a drag does — a
    // full-quest put (HoloSphere.put replaces the whole node, never merges),
    // plus the optimistic dispatch so it renders immediately.
    function persistCardPosition(id: string, position: { x: number; y: number }) {
        const card = questCards.find((c) => c.key === id);
        if (!card) return;
        positionAssignments.add(id);
        pendingPositionSaves.set(id, position);
        generatedInboxPositions.delete(id);

        if (card.quest._hologram?.isHologram) {
            // Holograms are read-only; their layout lives in localStorage.
            hologramPositions.set(id, position);
            saveHologramPositions();
            pendingPositionSaves.delete(id);
        } else if (holonID) {
            const updatedQuest = { ...card.quest, id, position };
            dispatch('questPositionChanged', { key: id, position });
            holosphere
                .put(holonID, 'quests', updatedQuest)
                .then(() => pendingPositionSaves.delete(id))
                .catch((error: unknown) => {
                    console.error('Auto-arrange save failed:', error);
                    pendingPositionSaves.delete(id);
                });
        }
    }

    // Auto-arrange cards as a left→right layered dependency graph (Sugiyama
    // style). Dependency depth (longest path from a root) sets the column, so
    // leaf prerequisites sit on the left and everything converges rightward into
    // the final goal. Within each column, nodes are ordered to minimise edge
    // crossings and given y-coordinates pulled toward their neighbours so an
    // aggregator node sits centred among the cards that feed into it.
    // Dependency-free cards are grid-packed below the graph.
    function autoArrangeByDependencies() {
        if (!holonID || questCards.length === 0) return;

        const byId = new Map(questCards.map((c) => [c.key, c]));
        const ids = questCards.map((c) => c.key);
        const parentsOf = (id: string): string[] =>
            (byId.get(id)?.quest?.dependencies ?? []).filter(
                (d: string) => d !== id && byId.has(d),
            );

        const childrenOf = new Map<string, string[]>(ids.map((id) => [id, []]));
        for (const id of ids) {
            for (const p of parentsOf(id)) childrenOf.get(p)!.push(id);
        }

        const hasEdge = (id: string) =>
            parentsOf(id).length > 0 || childrenOf.get(id)!.length > 0;
        const connectedIds = ids.filter(hasEdge);
        const isolatedIds = ids.filter((id) => !hasEdge(id));

        // Sizing. Layers run left→right (columns); nodes stack top→bottom (rows).
        const COL_GAP = 200; // horizontal room between columns for curved edges
        const COL_PITCH = CARD_WIDTH + COL_GAP;
        const MIN_VGAP = 50;
        const DEFAULT_CARD_HEIGHT = 220;
        const BASE_X = 200;
        const CENTER_Y = 400;
        // Measured rects are screen-space (canvas size × zoom); divide by zoom to
        // get the canvas-space height our positions are stored in.
        const measuredHeight = (id: string): number => {
            const m = getCardPosition(id);
            return m ? m.height / (zoom || 1) : DEFAULT_CARD_HEIGHT;
        };
        const ROW_PITCH =
            Math.max(DEFAULT_CARD_HEIGHT, ...ids.map(measuredHeight)) + MIN_VGAP;

        // Isotonic regression (pool-adjacent-violators): nearest non-decreasing
        // sequence in least squares. Removes vertical overlaps within a column
        // while keeping each node as close as possible to its desired y.
        const isotonic = (targets: number[]): number[] => {
            const mean: number[] = [];
            const weight: number[] = [];
            const count: number[] = [];
            for (const t of targets) {
                let m = t, w = 1, c = 1;
                while (mean.length > 0 && mean[mean.length - 1] >= m) {
                    const pm = mean.pop()!, pw = weight.pop()!, pc = count.pop()!;
                    m = (m * w + pm * pw) / (w + pw);
                    w += pw;
                    c += pc;
                }
                mean.push(m); weight.push(w); count.push(c);
            }
            const out: number[] = [];
            for (let k = 0; k < mean.length; k++) {
                for (let j = 0; j < count[k]; j++) out.push(mean[k]);
            }
            return out;
        };

        const finalX = new Map<string, number>();
        const finalY = new Map<string, number>();
        let graphBottom = CENTER_Y;

        if (connectedIds.length > 0) {
            const connectedSet = new Set(connectedIds);
            const parentsIn = (id: string) =>
                parentsOf(id).filter((p) => connectedSet.has(p));
            const childrenIn = (id: string) =>
                childrenOf.get(id)!.filter((c) => connectedSet.has(c));

            // --- 1. Column assignment: longest path from a root → depth. ---
            const depthCache = new Map<string, number>();
            const visiting = new Set<string>();
            const depthOf = (id: string): number => {
                if (depthCache.has(id)) return depthCache.get(id)!;
                if (visiting.has(id)) return 0; // break any dependency cycle
                const ps = parentsIn(id);
                if (ps.length === 0) { depthCache.set(id, 0); return 0; }
                visiting.add(id);
                const d = 1 + Math.max(...ps.map(depthOf));
                visiting.delete(id);
                depthCache.set(id, d);
                return d;
            };

            const layers = new Map<number, string[]>();
            for (const id of connectedIds) {
                const d = depthOf(id);
                if (!layers.has(d)) layers.set(d, []);
                layers.get(d)!.push(id);
            }
            const depths = [...layers.keys()].sort((a, b) => a - b);

            const orderIndex = new Map<string, number>();
            const reindex = () => {
                for (const d of depths) {
                    layers.get(d)!.forEach((id, i) => orderIndex.set(id, i));
                }
            };
            reindex();

            // --- 2. Crossing reduction: median-heuristic sweeps. ---
            const median = (arr: number[]): number => {
                if (arr.length === 0) return -1;
                const s = [...arr].sort((a, b) => a - b);
                const m = Math.floor(s.length / 2);
                return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
            };
            for (let it = 0; it < 8; it++) {
                const downward = it % 2 === 0; // order by left neighbours, then right
                const seq = downward ? depths : [...depths].reverse();
                for (const d of seq) {
                    const layer = layers.get(d)!;
                    const keyed = layer.map((id, i) => {
                        const ns = (downward ? parentsIn(id) : childrenIn(id)).map(
                            (n) => orderIndex.get(n) ?? 0,
                        );
                        const key = median(ns);
                        return { id, key: key < 0 ? i : key, fallback: i };
                    });
                    keyed.sort((a, b) => a.key - b.key || a.fallback - b.fallback);
                    layers.set(d, keyed.map((k) => k.id));
                    reindex();
                }
            }

            // --- 3. Y-coordinates: pull each node to its neighbours' barycentre,
            // then remove overlaps with isotonic regression so a column never
            // stacks two cards on top of each other. ---
            const y = new Map<string, number>();
            for (const d of depths) {
                layers.get(d)!.forEach((id, i) => y.set(id, i * ROW_PITCH));
            }
            const neighboursOf = (id: string) => [...parentsIn(id), ...childrenIn(id)];
            for (let it = 0; it < 16; it++) {
                for (const d of depths) {
                    const layer = layers.get(d)!;
                    const desired = layer.map((id) => {
                        const ns = neighboursOf(id).map((n) => y.get(n)!);
                        return ns.length
                            ? ns.reduce((a, b) => a + b, 0) / ns.length
                            : y.get(id)!;
                    });
                    const fitted = isotonic(desired.map((v, i) => v - i * ROW_PITCH));
                    layer.forEach((id, i) => y.set(id, fitted[i] + i * ROW_PITCH));
                }
            }

            // --- 4. X by column; centre the graph vertically on CENTER_Y. ---
            const allY = connectedIds.map((id) => y.get(id)!);
            const shift = CENTER_Y - (Math.min(...allY) + Math.max(...allY)) / 2;
            for (const d of depths) {
                for (const id of layers.get(d)!) {
                    finalX.set(id, BASE_X + d * COL_PITCH);
                    finalY.set(id, y.get(id)! + shift);
                }
            }
            graphBottom = Math.max(
                ...connectedIds.map((id) => finalY.get(id)! + measuredHeight(id)),
            );
        }

        // --- Grid-pack the isolated cards below the graph (square-ish block). ---
        if (isolatedIds.length > 0) {
            const ISO_SLOT = CARD_WIDTH + 60;
            const cols = Math.max(1, Math.round(Math.sqrt(isolatedIds.length * 1.6)));
            let curY = connectedIds.length > 0 ? graphBottom + ROW_PITCH : CENTER_Y;
            let col = 0;
            let rowMaxH = 0;
            for (const id of isolatedIds) {
                finalX.set(id, BASE_X + col * ISO_SLOT);
                finalY.set(id, curY);
                rowMaxH = Math.max(rowMaxH, measuredHeight(id));
                if (++col >= cols) {
                    col = 0;
                    curY += rowMaxH + MIN_VGAP;
                    rowMaxH = 0;
                }
            }
        }

        // Persist every card's computed position.
        for (const id of ids) {
            if (finalX.has(id)) {
                persistCardPosition(id, { x: finalX.get(id)!, y: finalY.get(id)! });
            }
        }

        // Frame the freshly arranged layout in view (zoom + centre, like the
        // fit-all button) so the whole graph is visible at once.
        if (viewContainer) {
            const rect = viewContainer.getBoundingClientRect();
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const id of ids) {
                if (!finalX.has(id)) continue;
                const fx = finalX.get(id)!;
                const fy = finalY.get(id)!;
                minX = Math.min(minX, fx);
                minY = Math.min(minY, fy);
                maxX = Math.max(maxX, fx + CARD_WIDTH);
                maxY = Math.max(maxY, fy + measuredHeight(id));
            }
            const PAD = 120;
            const contentW = Math.max(1, maxX - minX + PAD * 2);
            const contentH = Math.max(1, maxY - minY + PAD * 2);
            zoom = Math.min(
                MAX_ZOOM,
                Math.max(MIN_ZOOM, Math.min(rect.width / contentW, rect.height / contentH)),
            );
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            pan = {
                x: -(cx * zoom) + rect.width / 2,
                y: -(cy * zoom) + rect.height / 2,
            };
        }

        // Nudge reactivity so optimistic positions render immediately.
        pendingPositionSaves = pendingPositionSaves;
        positionAssignments = positionAssignments;
    }

    // Add these state variables at the top
    let touchStartDistance = 0;
    let touchStartZoom = 1;
    let touchStartPan = { x: 0, y: 0 };

    // Add these touch event handlers
    function handleTouchStart(event: TouchEvent) {
        event.preventDefault();
        console.log('Touch start:', event.touches.length, 'touches');
        
        if (event.touches.length === 2) {
            // Pinch to zoom
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            touchStartDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
            touchStartZoom = zoom;
            touchStartPan = { ...pan };
            
            // Calculate the midpoint (center of zoom)
            const rect = viewContainer.getBoundingClientRect();
            lastMouseX = ((touch1.clientX + touch2.clientX) / 2) - rect.left;
            lastMouseY = ((touch1.clientY + touch2.clientY) / 2) - rect.top;
        } else if (event.touches.length === 1) {
            // Check if touch is on a task card
            const touch = event.touches[0];
            const touchElement = document.elementFromPoint(touch.clientX, touch.clientY);
            const cardElement = touchElement?.closest('.task-card');
            
            if (cardElement && !drawingEnabled) {
                // Find the card data
                const cardKey = cardElement.getAttribute('data-key');
                const card = questCards.find(c => c.key === cardKey);
                
                if (card) {
                    isDragging = true;
                    draggedCard = card;
                    draggedCardVisuals = { key: card.key, x: card.x, y: card.y };
                    
                    const rect = canvas.getBoundingClientRect();
                    const touchX = (touch.clientX - rect.left - pan.x) / zoom;
                    const touchY = (touch.clientY - rect.top - pan.y) / zoom;
                    
                    offset = {
                        x: touchX - card.x,
                        y: touchY - card.y
                    };
                    return;
                }
            }
            
            // Single touch for panning
            startPan = {
                x: touch.clientX - pan.x,
                y: touch.clientY - pan.y
            };
            isPanning = true;
        }
    }

    function handleTouchMove(event: TouchEvent) {
        event.preventDefault();
        
        if (event.touches.length === 2) {
            // Handle pinch zoom
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            const currentDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
            
            // Calculate new zoom
            const zoomDelta = currentDistance / touchStartDistance;
            const newZoom = Math.min(Math.max(MIN_ZOOM, touchStartZoom * zoomDelta), MAX_ZOOM);
            
            // Calculate the point on canvas under the midpoint
            const canvasX = (lastMouseX - touchStartPan.x) / touchStartZoom;
            const canvasY = (lastMouseY - touchStartPan.y) / touchStartZoom;
            
            // Update zoom and pan to keep the point under the midpoint
            zoom = newZoom;
            pan = {
                x: lastMouseX - (canvasX * zoom),
                y: lastMouseY - (canvasY * zoom)
            };
        } else if (event.touches.length === 1) {
            if (isDragging && draggedCardVisuals && canvas) {
                // Handle card dragging
                const touch = event.touches[0];
                const rect = canvas.getBoundingClientRect();
                const touchX = (touch.clientX - rect.left - pan.x) / zoom;
                const touchY = (touch.clientY - rect.top - pan.y) / zoom;
                const newX = touchX - offset.x;
                const newY = touchY - offset.y;

                draggedCardVisuals.x = newX;
                draggedCardVisuals.y = newY;
            } else if (isPanning) {
                // Handle panning
                const touch = event.touches[0];
                pan = {
                    x: touch.clientX - startPan.x,
                    y: touch.clientY - startPan.y
                };
            }
        }
    }

    function handleTouchEnd(event: TouchEvent) {
        if (event.touches.length === 0) {
            // Handle card dragging completion
            if (isDragging && draggedCard && draggedCardVisuals && holonID) {
                const newPosition = { x: draggedCardVisuals.x, y: draggedCardVisuals.y };

                const dx = Math.abs(newPosition.x - draggedCard.x);
                const dy = Math.abs(newPosition.y - draggedCard.y);
                const moveThreshold = 5; // pixels

                // Check if it was a tap (not a drag)
                if (dx < moveThreshold && dy < moveThreshold) {
                    dispatch('taskClick', {
                        key: draggedCard.key,
                        quest: draggedCard.quest
                    });
                } else if (!drawingEnabled) {
                    // Save position when dragged
                    positionAssignments.add(draggedCard.key);
                    pendingPositionSaves.set(draggedCard.key, newPosition);
                    
                    // Clear generated inbox position since we now have a real position
                    generatedInboxPositions.delete(draggedCard.key);
                    
                    // Check if this is a hologram task
                    if (draggedCard.quest._hologram?.isHologram) {
                        hologramPositions.set(draggedCard.key, newPosition);
                        saveHologramPositions();
                        pendingPositionSaves.delete(draggedCard.key);
                        generatedInboxPositions.delete(draggedCard.key);
                    } else {
                        // Regular task - save to holosphere database
                        const updatedQuest = { 
                            ...draggedCard.quest,
                            id: draggedCard.key,
                            position: newPosition 
                        };
                        
                        dispatch('questPositionChanged', {
                            key: draggedCard.key,
                            position: newPosition
                        });
                        
                        holosphere.put(holonID, 'quests', updatedQuest)
                            .then(() => {
                                if (draggedCard) {
                                    pendingPositionSaves.delete(draggedCard.key);
                                }
                            })
                            .catch(error => {
                                console.error('Error updating quest position:', error);
                                if (draggedCard) {
                                    positionAssignments.delete(draggedCard.key);
                                    pendingPositionSaves.delete(draggedCard.key);
                                }
                            });
                    }
                }
            }
            
            // Reset states
            isDragging = false;
            draggedCard = null;
            draggedCardVisuals = null;
            isPanning = false;
        }
    }

    // Initialize from localStorage or use defaults
    if (typeof window !== 'undefined') {
        const savedView = localStorage.getItem('canvasViewState');
        if (savedView) {
            const { zoom: savedZoom, pan: savedPan } = JSON.parse(savedView);
            zoom = savedZoom;
            pan = savedPan;
        }
    }

    // Save view state whenever pan or zoom changes
    $: if (typeof window !== 'undefined') {
        localStorage.setItem('canvasViewState', JSON.stringify({ zoom, pan }));
    }







    onMount(() => {
        if (!canvas || !viewContainer) return;
        
        console.log('Canvas mounted, viewContainer:', viewContainer, 'canvas:', canvas);

        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (isDragging || isPanning || isDrawing || isMovingDrawing || isResizingImage || isRotatingImage) {
                handleMouseMove(e);
            }
        };

        const handleGlobalMouseUp = (e: MouseEvent) => {
            if (isDragging || isPanning || isDrawing || isMovingDrawing || isResizingImage || isRotatingImage) {
                handleMouseUp(e);
            }
        };

        window.addEventListener('keydown', handleCanvasKeydown);
        
        window.addEventListener('mousemove', handleGlobalMouseMove, { passive: false });
        window.addEventListener('mouseup', handleGlobalMouseUp, { passive: false });
        viewContainer.addEventListener('wheel', handleWheel, { passive: false });

        // Add touch event listeners for mobile support
        viewContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
        viewContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
        viewContainer.addEventListener('touchend', handleTouchEnd, { passive: false });

            // Mobile-specific initialization
    let isMobile = false;
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        isMobile = true;
        console.log('Mobile device detected, initializing mobile-specific settings');
        // Ensure proper sizing on mobile
        setTimeout(() => {
            if (viewContainer) {
                const rect = viewContainer.getBoundingClientRect();
                console.log('Mobile viewport size:', rect.width, 'x', rect.height);
            }
        }, 100);
    }

        // Only center the view if there's no saved state
        if (!localStorage.getItem('canvasViewState')) {
            // Wait a bit for questCards to be populated, then center on tasks
            setTimeout(() => {
                if (questCards.length > 0) {
                    centerOnTasks();
                } else {
                    // Fallback to center on inbox area if no tasks
                    const containerRect = viewContainer.getBoundingClientRect();
                    pan = { 
                        x: -(INBOX_CENTER.x * zoom) + containerRect.width / 2, 
                        y: -(INBOX_CENTER.y * zoom) + containerRect.height / 2 
                    };
                }
            }, 100);
        }

        const handleFullscreenChange = () => {
            isFullscreen = !!(
                document.fullscreenElement ||
                (document as any).webkitFullscreenElement ||
                (document as any).msFullscreenElement
            );
        };
        
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);

        // Subscribe for real-time drawing updates on the 'canvases' lens.
        let drawingsOff: (()=>void)|undefined;
        if (holosphere && holonID) {
            const watchedCid = effectiveCanvasId;
            try {
                const sub = holosphere.subscribe(holonID, 'canvases', (entry: any, key?: string) => {
                    if (entry && key === watchedCid) {
                        if (entry.updatedAt && entry.updatedAt <= drawingsUpdatedAt) return; // ignore older updates
                        if (Array.isArray(entry.data)) {
                            drawings = entry.data;
                            drawingsUpdatedAt = entry.updatedAt || Date.now();
                        }
                    }
                });
                drawingsOff = sub.unsubscribe;
            } catch (e) {
                console.error(e);
            }
        }

        return () => {
            if (drawingsOff) drawingsOff();
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
            window.removeEventListener('keydown', handleCanvasKeydown);
            viewContainer?.removeEventListener('wheel', handleWheel);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
            
            // Clean up touch events
            if (viewContainer) {
                viewContainer.removeEventListener('touchstart', handleTouchStart);
                viewContainer.removeEventListener('touchmove', handleTouchMove);
                viewContainer.removeEventListener('touchend', handleTouchEnd);
            }
            
            // Clear position tracking
            positionAssignments.clear();
            pendingPositionSaves.clear();
            hologramPositions.clear();
        };
    });

    // -------- Move drawings logic --------
    let isMobile = false;

    // Axis-aligned bounding box for any drawing, in canvas coordinates and in
    // the drawing's local (unrotated) frame. Used by selection rendering,
    // resize, rotate, and the floating action bar so a single code path drives
    // all four drawing kinds.
    function getDrawingBounds(d: any): { x: number; y: number; width: number; height: number } {
        if (!d) return { x: 0, y: 0, width: 0, height: 0 };
        if (d.type === 'image') {
            return { x: d.x, y: d.y, width: d.width, height: d.height };
        }
        if (d.type === 'text') {
            const fs = d.fontSize || 16;
            const w = Math.max(8, (d.text?.length || 4) * fs * 0.6);
            return { x: d.x, y: d.y, width: w, height: fs };
        }
        if (d.type === 'line' && d.points?.length === 2) {
            const [p1, p2] = d.points;
            const x = Math.min(p1.x, p2.x);
            const y = Math.min(p1.y, p2.y);
            return { x, y, width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y) };
        }
        if (d.type === 'path' && d.points?.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of d.points as { x: number; y: number }[]) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        }
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    // Transform a canvas point back into a drawing's local (unrotated) frame
    // for hit-testing rotated drawings.
    function inverseRotatePoint(point: { x: number; y: number }, d: any): { x: number; y: number } {
        const rot = d.rotation || 0;
        if (!rot) return point;
        const b = getDrawingBounds(d);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const rad = (-rot * Math.PI) / 180;
        const dx = point.x - cx;
        const dy = point.y - cy;
        return {
            x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
            y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
        };
    }

    function hitTestDrawing(point: {x:number;y:number}): number | null {
        // iterate from topmost
        for (let i = drawings.length - 1; i >= 0; i--) {
            const d = drawings[i];
            const p = inverseRotatePoint(point, d);
            if (d.type === 'text') {
                const b = getDrawingBounds(d);
                if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return i;
            } else if (d.type === 'image') {
                if (p.x >= d.x && p.x <= d.x + d.width && p.y >= d.y && p.y <= d.y + d.height) return i;
            } else if (d.type === 'line' && d.points?.length === 2) {
                const [p1,p2] = d.points;
                const dist = distancePointToSegment(p, p1, p2);
                if (dist < 6) return i;
            } else if (d.type === 'path' && d.points?.length>1) {
                for (let j=0;j<d.points.length-1;j++) {
                    if (distancePointToSegment(p, d.points[j], d.points[j+1])<6) return i;
                }
            }
        }
        return null;
    }

    // -------- Image drag-drop + resize --------
    const DEFAULT_IMAGE_PLACEMENT = 600; // initial on-canvas max width/height

    async function handleCanvasDrop(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
        isDraggingFiles = false;
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const dropPoint = getCanvasPoint(event.clientX, event.clientY);
        let cursorX = dropPoint.x;
        let cursorY = dropPoint.y;
        const newImages: any[] = [];
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue;
            const processed = await fileToDownscaledDataURL(file);
            if (!processed) continue;
            // Fit initial placement size to DEFAULT_IMAGE_PLACEMENT while preserving aspect ratio.
            let placeW = processed.width;
            let placeH = processed.height;
            const maxSide = Math.max(placeW, placeH);
            if (maxSide > DEFAULT_IMAGE_PLACEMENT) {
                const scale = DEFAULT_IMAGE_PLACEMENT / maxSide;
                placeW = Math.round(placeW * scale);
                placeH = Math.round(placeH * scale);
            }
            // Center the image on the drop point for the first, then offset subsequent images.
            newImages.push({
                type: 'image',
                src: processed.src,
                x: cursorX - placeW / 2,
                y: cursorY - placeH / 2,
                width: placeW,
                height: placeH,
                timestamp: Date.now()
            });
            // Cascade offset for additional drops
            cursorX += 24;
            cursorY += 24;
        }
        if (newImages.length > 0) {
            drawings = [...drawings, ...newImages];
            // Make the newly dropped image immediately interactive. In
            // standalone mode the canvas is always editable; in the embedded
            // (Tasks) view, flip into drawing+hand mode so the user can
            // resize/move without an extra click.
            if (!isStandalone && !drawingEnabled) {
                drawingEnabled = true;
                currentTool = 'hand';
            }
            selectedDrawingIndex = drawings.length - 1;
            await saveDrawings();
        }
    }

    function handleCanvasDragOver(event: DragEvent) {
        if (!event.dataTransfer) return;
        const hasFiles = Array.from(event.dataTransfer.types || []).includes('Files');
        if (!hasFiles) return;
        event.preventDefault();
        event.stopPropagation();
        isDraggingFiles = true;
        try { event.dataTransfer.dropEffect = 'copy'; } catch {}
    }

    function handleCanvasDragLeave(event: DragEvent) {
        // Only clear when leaving the container (relatedTarget outside).
        const relatedTarget = event.relatedTarget as Node | null;
        if (!relatedTarget || !viewContainer?.contains(relatedTarget)) {
            isDraggingFiles = false;
        }
    }

    // Apply a new bounding box directly to an image drawing. Only images use
    // the "bbox matches mouse" resize semantic — text/line/path get a
    // dampened, linear-in-drag scaling computed inline in applySelectionResize.
    function applyBoundsToDrawing(d: any, _oldB: { x: number; y: number; width: number; height: number }, newB: { x: number; y: number; width: number; height: number }) {
        if (d.type === 'image') {
            d.x = newB.x;
            d.y = newB.y;
            d.width = newB.width;
            d.height = newB.height;
        }
    }

    function beginSelectionResize(event: MouseEvent, handle: 'nw' | 'ne' | 'sw' | 'se') {
        if (selectedDrawingIndex === null) return;
        const d = drawings[selectedDrawingIndex];
        if (!d) return;
        event.preventDefault();
        event.stopPropagation();
        isResizingImage = true;
        resizeHandle = handle;
        resizeStartRect = getDrawingBounds(d);
        resizeStartPoint = getCanvasPoint(event.clientX, event.clientY);
        resizeKeepAspect = event.shiftKey;
        if (d.type === 'text') {
            resizeStartMeta = { fontSize: d.fontSize || 16 };
        } else if ((d.type === 'line' || d.type === 'path') && Array.isArray(d.points)) {
            resizeStartMeta = { points: d.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })) };
        } else {
            resizeStartMeta = null;
        }
    }

    function applySelectionResize(event: MouseEvent) {
        if (!isResizingImage || selectedDrawingIndex === null || !resizeStartRect || !resizeStartPoint || !resizeHandle) return;
        const d = drawings[selectedDrawingIndex];
        if (!d) return;
        const cur = getCanvasPoint(event.clientX, event.clientY);
        const dx = cur.x - resizeStartPoint.x;
        const dy = cur.y - resizeStartPoint.y;

        if (d.type === 'image') {
            // Images: classic bbox-tracks-mouse resize. Anchor is the corner
            // opposite the dragged handle.
            let nx = resizeStartRect.x;
            let ny = resizeStartRect.y;
            let nw = resizeStartRect.width;
            let nh = resizeStartRect.height;

            if (resizeHandle === 'se') {
                nw = resizeStartRect.width + dx;
                nh = resizeStartRect.height + dy;
            } else if (resizeHandle === 'ne') {
                nw = resizeStartRect.width + dx;
                nh = resizeStartRect.height - dy;
                ny = resizeStartRect.y + dy;
            } else if (resizeHandle === 'sw') {
                nw = resizeStartRect.width - dx;
                nx = resizeStartRect.x + dx;
                nh = resizeStartRect.height + dy;
            } else if (resizeHandle === 'nw') {
                nw = resizeStartRect.width - dx;
                nx = resizeStartRect.x + dx;
                nh = resizeStartRect.height - dy;
                ny = resizeStartRect.y + dy;
            }

            const MIN = 8;
            if (nw < MIN) {
                if (resizeHandle === 'nw' || resizeHandle === 'sw') nx = resizeStartRect.x + resizeStartRect.width - MIN;
                nw = MIN;
            }
            if (nh < MIN) {
                if (resizeHandle === 'nw' || resizeHandle === 'ne') ny = resizeStartRect.y + resizeStartRect.height - MIN;
                nh = MIN;
            }

            if (resizeKeepAspect || event.shiftKey) {
                const aspect = resizeStartRect.width / resizeStartRect.height;
                if (Math.abs(nw - resizeStartRect.width) > Math.abs(nh - resizeStartRect.height)) {
                    const newH = nw / aspect;
                    if (resizeHandle === 'nw' || resizeHandle === 'ne') ny = resizeStartRect.y + (resizeStartRect.height - newH);
                    nh = newH;
                } else {
                    const newW = nh * aspect;
                    if (resizeHandle === 'nw' || resizeHandle === 'sw') nx = resizeStartRect.x + (resizeStartRect.width - newW);
                    nw = newW;
                }
            }

            applyBoundsToDrawing(d, resizeStartRect, { x: nx, y: ny, width: nw, height: nh });
        } else {
            // Text / line / path: linear-in-drag uniform scaling around the
            // corner opposite the dragged handle. Decoupled from the bbox
            // size so a tiny drawing doesn't explode under a long drag.
            const xSign = (resizeHandle === 'se' || resizeHandle === 'ne') ? 1 : -1;
            const ySign = (resizeHandle === 'se' || resizeHandle === 'sw') ? 1 : -1;
            const outward = (xSign * dx + ySign * dy) / 2;
            let uniformScale = 1 + outward / NONIMAGE_RESIZE_REFERENCE;
            uniformScale = Math.max(0.1, Math.min(8, uniformScale));

            const anchorX = (resizeHandle === 'nw' || resizeHandle === 'sw')
                ? resizeStartRect.x + resizeStartRect.width
                : resizeStartRect.x;
            const anchorY = (resizeHandle === 'nw' || resizeHandle === 'ne')
                ? resizeStartRect.y + resizeStartRect.height
                : resizeStartRect.y;

            if (d.type === 'text') {
                const startFs = resizeStartMeta?.fontSize ?? 16;
                d.fontSize = Math.max(8, startFs * uniformScale);
                const newBounds = getDrawingBounds(d);
                const cornerOffsetX = (resizeHandle === 'nw' || resizeHandle === 'sw') ? newBounds.width : 0;
                const cornerOffsetY = (resizeHandle === 'nw' || resizeHandle === 'ne') ? newBounds.height : 0;
                d.x = anchorX - cornerOffsetX;
                d.y = anchorY - cornerOffsetY;
            } else if ((d.type === 'line' || d.type === 'path') && Array.isArray(resizeStartMeta?.points)) {
                d.points = resizeStartMeta.points.map((p: { x: number; y: number }) => ({
                    x: anchorX + (p.x - anchorX) * uniformScale,
                    y: anchorY + (p.y - anchorY) * uniformScale
                }));
            }
        }

        drawings = drawings; // trigger reactivity
    }

    function endSelectionResize() {
        if (!isResizingImage) return;
        isResizingImage = false;
        resizeHandle = null;
        resizeStartRect = null;
        resizeStartPoint = null;
        resizeStartMeta = null;
        saveDrawings();
    }

    function beginSelectionRotate(event: MouseEvent) {
        if (selectedDrawingIndex === null) return;
        const d = drawings[selectedDrawingIndex];
        if (!d) return;
        event.preventDefault();
        event.stopPropagation();
        const b = getDrawingBounds(d);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        rotateCenter = { x: cx, y: cy };
        const p = getCanvasPoint(event.clientX, event.clientY);
        rotateStartAngle = Math.atan2(p.y - cy, p.x - cx);
        rotateStartRotation = d.rotation || 0;
        isRotatingImage = true;
    }

    function applySelectionRotate(event: MouseEvent) {
        if (!isRotatingImage || selectedDrawingIndex === null || !rotateCenter) return;
        const d = drawings[selectedDrawingIndex];
        if (!d) return;
        const p = getCanvasPoint(event.clientX, event.clientY);
        const a = Math.atan2(p.y - rotateCenter.y, p.x - rotateCenter.x);
        let deg = rotateStartRotation + ((a - rotateStartAngle) * 180) / Math.PI;
        // Snap to 15° steps while holding shift.
        if (event.shiftKey) deg = Math.round(deg / 15) * 15;
        d.rotation = deg;
        drawings = drawings;
    }

    function endSelectionRotate() {
        if (!isRotatingImage) return;
        isRotatingImage = false;
        rotateCenter = null;
        saveDrawings();
    }

    function rotateSelectedBy(delta: number) {
        if (selectedDrawingIndex === null) return;
        const d = drawings[selectedDrawingIndex];
        if (!d) return;
        d.rotation = ((d.rotation || 0) + delta) % 360;
        drawings = drawings;
        saveDrawings();
    }

    function setSelectedTextFont(fontFamily: string) {
        if (selectedDrawingIndex === null) return;
        const d = drawings[selectedDrawingIndex];
        if (!d || d.type !== 'text') return;
        d.fontFamily = fontFamily;
        currentFontFamily = fontFamily;
        drawings = drawings;
        saveDrawings();
    }

    function deleteSelectedDrawing() {
        if (selectedDrawingIndex === null) return;
        drawings = drawings.filter((_, i) => i !== selectedDrawingIndex);
        selectedDrawingIndex = null;
        saveDrawings();
    }

    function handleCanvasKeydown(event: KeyboardEvent) {
        // Don't hijack keystrokes typed into the text-tool input.
        if (isEditingText) return;
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedDrawingIndex === null) return;
            event.preventDefault();
            deleteSelectedDrawing();
        } else if (event.key === 'Escape') {
            // First Esc clears the current selection. If nothing was
            // selected, let the host route decide what to do (e.g. a task
            // canvas navigates back to its TaskModal).
            if (selectedDrawingIndex !== null) {
                selectedDrawingIndex = null;
            } else {
                dispatch('escape');
            }
        }
    }

    // Focus the text input when the text tool places it on the canvas.
    $: if (isEditingText && textPosition) {
        tick().then(() => textInputEl?.focus());
    }

    function distancePointToSegment(p:any, v:any, w:any) {
        const l2 = (v.x-w.x)*(v.x-w.x)+(v.y-w.y)*(v.y-w.y);
        if (l2===0) return Math.hypot(p.x-v.x,p.y-v.y);
        let t = ((p.x-v.x)*(w.x-v.x)+(p.y-v.y)*(w.y-v.y))/l2;
        t = Math.max(0, Math.min(1,t));
        const proj = {x: v.x + t*(w.x-v.x), y: v.y + t*(w.y-v.y)};
        return Math.hypot(p.x-proj.x, p.y-proj.y);
    }
</script>

<div 
    class="w-full relative overflow-hidden bg-gray-900 rounded-lg transition-all duration-200"
    class:h-[600px]={!isFullscreen}
    class:fixed={isFullscreen}
    class:inset-0={isFullscreen}
    class:z-50={isFullscreen}
    class:rounded-none={isFullscreen}
    class:cursor-grab={!isDragging && !isPanning && !drawingEnabled}
    class:cursor-grabbing={(isDragging || isPanning) && !drawingEnabled}
    class:cursor-crosshair={drawingEnabled}
    bind:this={viewContainer}
    on:mousedown={(e) => {
        const taskCard = (e.target as HTMLElement).closest('.task-card');
        if (!taskCard) {
            e.preventDefault();
            e.stopPropagation();
            handleMouseDown(e);
        }
    }}
    on:mousemove={(e) => {
        if (isDragging || isPanning) {
            e.preventDefault();
            handleMouseMove(e);
        }
    }}
    on:mouseup={(e) => {
        if (isDragging || isPanning || draggedCard) {
            e.preventDefault();
            handleMouseUp(e);
        }
    }}
    on:touchstart|preventDefault={handleTouchStart}
    on:touchmove|preventDefault={handleTouchMove}
    on:touchend|preventDefault={handleTouchEnd}
    on:contextmenu|preventDefault
    on:dragover={handleCanvasDragOver}
    on:dragleave={handleCanvasDragLeave}
    on:drop={handleCanvasDrop}
    role="presentation"
    style="touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;"
>
    <!-- Drawing Tools Overlay -->
    <DrawingTools
        {drawingEnabled}
        {currentTool}
        {currentColor}
        {currentStroke}
        on:toggle={handleDrawingToggle}
        on:toolChange={handleToolChange}
        on:colorChange={handleColorChange}
        on:strokeChange={handleStrokeChange}
        on:clear={clearDrawings}
    />

    <!-- File drop overlay -->
    {#if isDraggingFiles}
        <div class="absolute inset-0 z-30 pointer-events-none flex items-center justify-center bg-blue-500 bg-opacity-10 border-4 border-dashed border-blue-400">
            <div class="px-6 py-4 bg-gray-900 bg-opacity-80 rounded-lg text-blue-200 text-lg font-medium">
                🖼️ Drop images to add them to the canvas
            </div>
        </div>
    {/if}

    <!-- Control Panel -->
    <div class="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <!-- Mobile indicator -->
        {#if isMobile}
            <div class="p-2 bg-yellow-800 bg-opacity-70 rounded-lg text-white text-xs text-center">
                📱 Mobile<br/>
                <span class="text-xs opacity-75">Tap & drag to move tasks</span>
            </div>
        {/if}
        
        {#if !isStandalone}
            <!-- Auto-arrange by dependencies button -->
            <button
                class="p-2 bg-gray-800 bg-opacity-50 hover:bg-gray-700 rounded-lg text-white text-opacity-70 hover:text-white hover:text-opacity-90 transition-colors"
                on:click={autoArrangeByDependencies}
                aria-label="Auto-arrange by dependencies"
                title="Auto-arrange by dependencies (prerequisites left → goal right)"
            >
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
                </svg>
            </button>
        {/if}

        <!-- Fit to scope: zoom out so every card is in view -->
        <button
            class="p-2 bg-gray-800 bg-opacity-50 hover:bg-gray-700 rounded-lg text-white text-opacity-70 hover:text-white hover:text-opacity-90 transition-colors"
            on:click={zoomToFit}
            aria-label="Fit all cards in view"
            title="Fit all cards in view"
        >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
            </svg>
        </button>

        <!-- Fullscreen toggle button -->
        <button
            class="p-2 bg-gray-800 bg-opacity-50 hover:bg-gray-700 rounded-lg text-white text-opacity-70 hover:text-white hover:text-opacity-90 transition-colors"
            on:click={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
            {#if isFullscreen}
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            {:else}
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 3h6m0 0v6m0-6L13 11m-4 10H3m0 0v-6m0 6l8-8" />
                </svg>
            {/if}
        </button>

        {#if !isStandalone}
        <!-- Minimap -->
        <div class="bg-gray-800 bg-opacity-90 rounded-lg p-2 border border-gray-600">
            <div class="text-white text-opacity-70 text-xs mb-1 text-center">Map</div>
            <div 
                class="relative bg-gray-900 border border-gray-700 cursor-pointer"
                style="width: 120px; height: 90px;"
                on:click={handleMinimapClick}
                on:keydown={(e) => e.key === 'Enter' && handleMinimapClick(e)}
                role="button"
                tabindex="0"
                title="Click to navigate"
            >
                <!-- Canvas bounds -->
                <div class="absolute inset-0 border border-gray-600 rounded"></div>
                
                <!-- Current viewport indicator -->
                <div 
                    class="absolute border-2 border-blue-400 bg-blue-400 bg-opacity-20 rounded"
                    style="left: {minimapViewX}px; 
                           top: {minimapViewY}px; 
                           width: {minimapViewWidth}px; 
                           height: {minimapViewHeight}px;"
                ></div>
                
                <!-- Task cards as dots -->
                {#each questCards as card}
                    {@const minimapX = minimapTransform.offsetX + (card.x + CARD_WIDTH / 2 - minimapTransform.minX) * minimapTransform.scale}
                    {@const minimapY = minimapTransform.offsetY + (card.y + CARD_HEIGHT_ESTIMATE / 2 - minimapTransform.minY) * minimapTransform.scale}
                    <div 
                        class="absolute rounded-full border border-white"
                        style="left: {minimapX - 2}px; 
                               top: {minimapY - 2}px; 
                               width: 4px; 
                               height: 4px;
                               background-color: {card.quest.status === 'completed' 
                                   ? '#10B981' 
                                   : card.quest._hologram?.isHologram 
                                       ? '#00BFFF' 
                                       : '#F59E0B'};"
                        title={card.quest.title}
                    ></div>
                {/each}
            </div>
            <div class="text-white text-opacity-50 text-xs mt-1 text-center">
                {questCards.length} tasks
            </div>
        </div>
        {/if}
    </div>

    <div
        bind:this={canvas}
        class="absolute w-full h-full"
        style="width: {CANVAS_WIDTH}px; height: {CANVAS_HEIGHT}px; transform: translate({pan.x}px, {pan.y}px) scale({zoom}); transform-origin: 0 0;"
    >
        <!-- Grid background -->
        <div class="absolute inset-0 grid-background"></div>

        <!-- Drawing Layer -->
        <svg 
            class="absolute inset-0 pointer-events-none"
            width="{CANVAS_WIDTH}"
            height="{CANVAS_HEIGHT}"
            viewBox="0 0 {CANVAS_WIDTH} {CANVAS_HEIGHT}"
            xmlns="http://www.w3.org/2000/svg"
        >
            <!-- Saved drawings. Each drawing renders inside a <g> so an
                 optional rotation transform can be applied uniformly across
                 every drawing type. -->
            {#each drawings as drawing, i}
                {@const db = getDrawingBounds(drawing)}
                {@const dcx = db.x + db.width / 2}
                {@const dcy = db.y + db.height / 2}
                {@const rot = drawing.rotation ? `rotate(${drawing.rotation} ${dcx} ${dcy})` : undefined}
                <g transform={rot}>
                    {#if drawing.type === 'path' && drawing.points && drawing.points.length > 1}
                        {@const pathData = `M ${drawing.points[0].x},${drawing.points[0].y} ${drawing.points.slice(1).map(p => `L ${p.x},${p.y}`).join(' ')}`}
                        <path
                            d={pathData}
                            stroke={drawing.color || '#3B82F6'}
                            stroke-width={drawing.strokeWidth || 3}
                            fill="none"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    {:else if drawing.type === 'line' && drawing.points && drawing.points.length === 2}
                        <line
                            x1={drawing.points[0].x}
                            y1={drawing.points[0].y}
                            x2={drawing.points[1].x}
                            y2={drawing.points[1].y}
                            stroke={drawing.color || '#3B82F6'}
                            stroke-width={drawing.strokeWidth || 3}
                            stroke-linecap="round"
                        />
                    {:else if drawing.type === 'text'}
                        <text
                            x={drawing.x}
                            y={drawing.y}
                            fill={drawing.color || '#3B82F6'}
                            font-size={drawing.fontSize || 16}
                            font-family={drawing.fontFamily || 'sans-serif'}
                            dominant-baseline="hanging"
                        >
                            {drawing.text}
                        </text>
                    {:else if drawing.type === 'image' && drawing.src}
                        <image
                            href={drawing.src}
                            x={drawing.x}
                            y={drawing.y}
                            width={drawing.width}
                            height={drawing.height}
                            preserveAspectRatio="xMidYMid meet"
                        />
                    {/if}
                </g>
            {/each}

            <!-- Selection overlay + resize / rotate handles for the currently
                 selected drawing (works for image, text, line, path). -->
            {#if canEditCanvas && selectedDrawingIndex !== null && drawings[selectedDrawingIndex]}
                {@const sel = drawings[selectedDrawingIndex]}
                {@const b = getDrawingBounds(sel)}
                {@const pad = 6}
                {@const bx = b.x - pad}
                {@const by = b.y - pad}
                {@const bw = b.width + pad * 2}
                {@const bh = b.height + pad * 2}
                {@const cx = b.x + b.width / 2}
                {@const cy = b.y + b.height / 2}
                {@const rotateAttr = sel.rotation ? `rotate(${sel.rotation} ${cx} ${cy})` : undefined}
                <g transform={rotateAttr}>
                    <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        fill="none"
                        stroke="#3B82F6"
                        stroke-width="2"
                        stroke-dasharray="6 4"
                        class="pointer-events-none"
                    />
                    {#each [
                        { corner: 'nw', x: bx, y: by },
                        { corner: 'ne', x: bx + bw, y: by },
                        { corner: 'sw', x: bx, y: by + bh },
                        { corner: 'se', x: bx + bw, y: by + bh }
                    ] as h}
                        <rect
                            x={h.x - 6}
                            y={h.y - 6}
                            width="12"
                            height="12"
                            fill="#3B82F6"
                            stroke="white"
                            stroke-width="2"
                            class="image-resize-handle"
                            data-handle={h.corner}
                            style="cursor: {h.corner === 'nw' || h.corner === 'se' ? 'nwse-resize' : 'nesw-resize'}; pointer-events: auto;"
                        />
                    {/each}
                    <!-- Rotation handle: a small circle above the top edge, connected by a stem. -->
                    <line
                        x1={cx}
                        y1={by}
                        x2={cx}
                        y2={by - 28}
                        stroke="#3B82F6"
                        stroke-width="2"
                        class="pointer-events-none"
                    />
                    <circle
                        cx={cx}
                        cy={by - 32}
                        r="8"
                        fill="#3B82F6"
                        stroke="white"
                        stroke-width="2"
                        class="image-rotate-handle"
                        style="cursor: grab; pointer-events: auto;"
                    />
                </g>
            {/if}
            
            <!-- Current drawing preview -->
            {#if currentTool === 'line' && currentPath.length === 2}
                <line
                    x1={currentPath[0].x}
                    y1={currentPath[0].y}
                    x2={currentPath[1].x}
                    y2={currentPath[1].y}
                    stroke={currentColor}
                    stroke-width={currentStroke}
                    stroke-linecap="round"
                    opacity="0.6"
                />
            {/if}

            {#if currentTool === 'free' && currentPath.length > 1}
                {@const pathD = `M ${currentPath[0].x},${currentPath[0].y} ${currentPath.slice(1).map(p => `L ${p.x},${p.y}`).join(' ')}`}
                <path d={pathD} stroke={currentColor} stroke-width={currentStroke} fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" />
            {/if}
        </svg>

        <!-- Text Input Field -->
        {#if isEditingText && textPosition}
            <input
                type="text"
                bind:value={textInput}
                bind:this={textInputEl}
                on:keydown|stopPropagation={handleTextInput}
                on:mousedown|stopPropagation
                class="absolute bg-white border border-gray-300 px-2 py-1 rounded text-black z-20"
                style="left: {textPosition.x}px;
                       top: {textPosition.y}px;
                       font-size: {currentStroke * 4}px;
                       font-family: {currentFontFamily};"
                placeholder="Type text and press Enter"
            />
        {/if}

        <!-- Floating action bar for the currently selected drawing -->
        {#if canEditCanvas && selectedDrawingIndex !== null && drawings[selectedDrawingIndex]}
            {@const sel2 = drawings[selectedDrawingIndex]}
            {@const selBounds = getDrawingBounds(sel2)}
            {@const barX = selBounds.x}
            {@const barY = selBounds.y - 76}
            <div
                class="canvas-action-bar absolute z-30 flex items-center gap-1 bg-gray-900/90 border border-gray-700 rounded-lg px-2 py-1 shadow-lg"
                style="left: {barX}px; top: {barY}px;"
                on:mousedown|stopPropagation
                role="toolbar"
                tabindex="-1"
                aria-label="Canvas selection actions"
            >
                {#if sel2.type === 'text'}
                    <select
                        class="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400"
                        value={sel2.fontFamily || 'sans-serif'}
                        on:change={(e) => setSelectedTextFont((e.currentTarget as HTMLSelectElement).value)}
                        on:mousedown|stopPropagation
                        title="Font"
                    >
                        {#each FONT_OPTIONS as f}
                            <option value={f.value} style="font-family: {f.value};">{f.label}</option>
                        {/each}
                    </select>
                {/if}
                <button
                    type="button"
                    class="px-2 py-1 text-xs text-gray-200 hover:text-white hover:bg-gray-700 rounded"
                    on:click={() => rotateSelectedBy(-90)}
                    title="Rotate 90° counter-clockwise"
                >
                    ↺
                </button>
                <button
                    type="button"
                    class="px-2 py-1 text-xs text-gray-200 hover:text-white hover:bg-gray-700 rounded"
                    on:click={() => rotateSelectedBy(90)}
                    title="Rotate 90° clockwise"
                >
                    ↻
                </button>
                <button
                    type="button"
                    class="px-2 py-1 text-xs text-red-300 hover:text-white hover:bg-red-500/40 rounded"
                    on:click={deleteSelectedDrawing}
                    title="Delete (Del)"
                >
                    🗑
                </button>
            </div>
        {/if}

        {#if !isStandalone}
            <!-- Dependency arrows: drawn in canvas (logical) coordinates inside
                 the transformed canvas, so they pan/zoom with the cards and need
                 no DOM measurement (they never go stale on filter/complete). -->
            <svg
                class="absolute inset-0 pointer-events-none z-10"
                width="{CANVAS_WIDTH}"
                height="{CANVAS_HEIGHT}"
                viewBox="0 0 {CANVAS_WIDTH} {CANVAS_HEIGHT}"
                xmlns="http://www.w3.org/2000/svg"
                style="overflow: visible;"
            >
                <defs>
                    <marker
                        id="dep-arrowhead"
                        markerWidth="11"
                        markerHeight="10"
                        refX="9"
                        refY="5"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                    >
                        <polygon points="0 0, 9 5, 0 10" fill="#9ca3af" />
                    </marker>
                </defs>
                {#each questCards as card (card.key)}
                    {#if card.quest.dependencies && card.quest.dependencies.length > 0}
                        {#each card.quest.dependencies as dependencyId}
                            {@const dependencyCard = questCards.find(c => c.key === dependencyId)}
                            {#if dependencyCard}
                                {@const depX = draggedCardVisuals && draggedCardVisuals.key === dependencyCard.key ? draggedCardVisuals.x : dependencyCard.x}
                                {@const depY = draggedCardVisuals && draggedCardVisuals.key === dependencyCard.key ? draggedCardVisuals.y : dependencyCard.y}
                                {@const cardX = draggedCardVisuals && draggedCardVisuals.key === card.key ? draggedCardVisuals.x : card.x}
                                {@const cardY = draggedCardVisuals && draggedCardVisuals.key === card.key ? draggedCardVisuals.y : card.y}
                                {@const depCX = depX + CARD_WIDTH / 2}
                                {@const depCY = depY + CARD_HEIGHT_ESTIMATE / 2}
                                {@const cardCX = cardX + CARD_WIDTH / 2}
                                {@const cardCY = cardY + CARD_HEIGHT_ESTIMATE / 2}
                                {@const start = borderPoint(depX, depY, CARD_WIDTH, CARD_HEIGHT_ESTIMATE, cardCX, cardCY)}
                                {@const end = borderPoint(cardX, cardY, CARD_WIDTH, CARD_HEIGHT_ESTIMATE, depCX, depCY)}
                                {@const dx = end.x - start.x}
                                {@const dy = end.y - start.y}
                                {@const dist = Math.hypot(dx, dy)}
                                {@const offset = Math.max(40, Math.min(120, dist / 2.5))}
                                {@const horizontal = Math.abs(dx) > Math.abs(dy)}
                                {@const c1x = horizontal ? start.x + Math.sign(dx) * offset : start.x}
                                {@const c1y = horizontal ? start.y : start.y + Math.sign(dy) * offset}
                                {@const c2x = horizontal ? end.x - Math.sign(dx) * offset : end.x}
                                {@const c2y = horizontal ? end.y : end.y - Math.sign(dy) * offset}
                                <path
                                    d="M {start.x} {start.y} C {c1x} {c1y}, {c2x} {c2y}, {end.x} {end.y}"
                                    stroke="#9ca3af"
                                    stroke-width="1.5"
                                    fill="none"
                                    opacity="0.7"
                                    vector-effect="non-scaling-stroke"
                                    marker-end="url(#dep-arrowhead)"
                                />
                            {/if}
                        {/each}
                    {/if}
                {/each}
            </svg>
        {/if}

        {#if !isStandalone}
        {#each questCards as card (card.key)}
            <div
                class="absolute task-card"
                class:cursor-move={!isDragging && !drawingEnabled}
                class:cursor-grabbing={isDragging && draggedCardVisuals?.key === card.key}
                class:cursor-crosshair={drawingEnabled}
                data-key={card.key}
                style="left: {(draggedCardVisuals && draggedCardVisuals.key === card.key ? draggedCardVisuals.x : card.x)}px; 
                       top:  {(draggedCardVisuals && draggedCardVisuals.key === card.key ? draggedCardVisuals.y : card.y)}px; 
                       width: {CARD_WIDTH}px;
                       transform: scale(1); transform-origin: top left;"
                on:mousedown|stopPropagation={(e) => {
                    if (drawingEnabled) {
                        // When drawing is enabled, let the event bubble up to the main canvas handler
                        e.stopPropagation();
                        handleMouseDown(e);
                    } else {
                        // Normal task card interaction
                        handleMouseDown(e, card);
                    }
                }}
                role="presentation"
                use:trackCardElement={card.key}
            >


                <TaskCard
                    quest={card.quest}
                    variant="canvas"
                    {holonID}
                    showCreated
                    extraClass="w-80"
                />


            </div>
        {/each}
        {/if}

    </div>

</div>

<style>
    .grid-background {
        background-image: 
            linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
        background-size: 40px 40px;
    }

    .task-card {
        backface-visibility: hidden;
        -webkit-font-smoothing: subpixel-antialiased;
        /* Canvas cards are absolutely positioned at their (x, y). This scoped
           rule must NOT override the `absolute` utility with `relative` — doing
           so drops the cards into normal flow, stacking them with a growing
           vertical offset so they no longer sit at card.x/card.y (and the
           dependency arrows, which use those logical coords, stop matching). */
        position: absolute;
        user-select: none;
    }

    div {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    
    div::-webkit-scrollbar {
        display: none;
    }

    /* Prevent text from becoming blurry during transforms */
    :global(.task-card *) {
        transform: translateZ(0);
    }

    /* Add styles for fullscreen mode */
    :global(body:has(.fixed)) {
        overflow: hidden;
    }

    /* Add these fullscreen styles */
    :global(.fixed) {
        position: fixed !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
    }

    :global(:fullscreen),
    :global(:-webkit-full-screen),
    :global(:-ms-fullscreen) {
        width: 100% !important;
        height: 100% !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 999999 !important;
        background: #1a1a1a !important;
    }

    /* Mobile-specific styles */
    @media (max-width: 768px) {
        .task-card {
            touch-action: none;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            -khtml-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }
        
        /* Prevent zoom on double tap */
        :global(*) {
            touch-action: manipulation;
        }
    }
</style> 