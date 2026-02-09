<script lang="ts">
    import { createEventDispatcher, getContext, onMount, afterUpdate } from 'svelte';
    import { goto } from '$app/navigation';
    import { formatDate, formatTime } from '../utils/date.js';
    import type { HoloSphere } from 'holosphere';
    import DrawingTools from './DrawingTools.svelte';
    import { buildHologramLink } from '$lib/stores/nameResolver';

    const holosphere = getContext("holosphere") as HoloSphere;

    export let filteredQuests: [string, any][];
    export let holonID: string;
    export let showCompleted: boolean;

    const dispatch = createEventDispatcher();
    let canvas: HTMLElement;
    let container: HTMLElement;
    let viewContainer: HTMLElement;
    let isDragging = false;
    let draggedCard: { key: string; quest: any; x: number; y: number; } | null = null;
    let offset = { x: 0, y: 0 };
    let zoom = 1;
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



    // Initialize positions if not set - move this out of the reactive statement
    let questCards: { key: string; quest: any; x: number; y: number; }[] = [];
    let positionAssignments = new Set<string>(); // Track which quests have been assigned positions
    let pendingPositionSaves = new Map<string, { x: number; y: number }>(); // Track pending saves
    let hologramPositions = new Map<string, { x: number; y: number }>(); // Local storage for hologram positions
    let generatedInboxPositions = new Map<string, { x: number; y: number }>(); // Cache for generated inbox positions

    const CARD_WIDTH = 320; // Based on w-80 class (20rem * 16px/rem)
    const CARD_HEIGHT_ESTIMATE = 120; // Estimated height for arrow connection

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

        // Load drawings
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
        try {
            const entry = await holosphere.get(holonID, 'canvas', 'drawings');
            if (entry && entry.data && Array.isArray(entry.data)) {
                drawings = entry.data;
                drawingsUpdatedAt = entry.updatedAt || 0;
            } else if (Array.isArray(entry)) { // backward compatibility
                drawings = entry;
            } else {
                drawings = [];
            }
        } catch (error) {
            console.error('Error loading drawings:', error);
            drawings = [];
        }
    }

    async function saveDrawings() {
        if (!holosphere || !holonID) return;
        drawingsUpdatedAt = Date.now();
        try {
            await holosphere.put(holonID, 'canvas', { id: 'drawings', data: drawings, updatedAt: drawingsUpdatedAt });
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

    $: if (viewContainer && typeof window !== 'undefined') {
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
        
        // Convert to minimap coordinates
        const viewX = (visibleLeft / CANVAS_WIDTH) * MINIMAP_WIDTH;
        const viewY = (visibleTop / CANVAS_HEIGHT) * MINIMAP_HEIGHT;
        const viewWidth = (visibleWidth / CANVAS_WIDTH) * MINIMAP_WIDTH;
        const viewHeight = (visibleHeight / CANVAS_HEIGHT) * MINIMAP_HEIGHT;
        
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

        // Convert minimap coordinates to canvas coordinates
        const canvasX = (clickX / MINIMAP_WIDTH) * CANVAS_WIDTH;
        const canvasY = (clickY / MINIMAP_HEIGHT) * CANVAS_HEIGHT;

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
        
        // Handle drawing mode - disable all other interactions
        if (drawingEnabled && event.button === 0) {
            const point = getCanvasPoint(event.clientX, event.clientY);
            
            if (currentTool === 'hand') {
                // try select drawing
                const idx = hitTestDrawing(point);
                if (idx!==null) {
                    isMovingDrawing = true;
                    selectedDrawingIndex = idx;
                    lastMovePoint = { ...point };
                    return;
                }
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
        
        // Handle drawing mode - only allow drawing interactions
        if (drawingEnabled && isMovingDrawing && selectedDrawingIndex!==null) {
            const point = getCanvasPoint(event.clientX, event.clientY);
            const deltaX = point.x - lastMovePoint.x;
            const deltaY = point.y - lastMovePoint.y;
            if (deltaX===0 && deltaY===0) return;
            const d = drawings[selectedDrawingIndex];
            if (d.type === 'text') {
                d.x += deltaX;
                d.y += deltaY;
            } else if (d.type==='line' && d.points?.length===2) {
                d.points.forEach((p:any)=>{p.x+=deltaX; p.y+=deltaY;});
            } else if (d.type==='path' && d.points?.length>0) {
                d.points.forEach((p:any)=>{p.x+=deltaX; p.y+=deltaY;});
            }
            lastMovePoint = point;
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
        
        // Handle drawing mode - only process drawing interactions
        if (drawingEnabled && isMovingDrawing) {
            isMovingDrawing = false;
            selectedDrawingIndex = null;
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
            zoom = Math.min(Math.max(0.25, zoom * zoomFactor), 2);

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
            const newZoom = Math.min(Math.max(0.25, touchStartZoom * zoomDelta), 2);
            
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
            if (isDragging || isPanning || isDrawing || isMovingDrawing) {
                handleMouseMove(e);
            }
        };
        
        const handleGlobalMouseUp = (e: MouseEvent) => {
            if (isDragging || isPanning || isDrawing || isMovingDrawing) {
                handleMouseUp(e);
            }
        };
        
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

        // Subscribe for real-time drawing updates
        let drawingsOff: (()=>void)|undefined;
        if (holosphere && holonID) {
            holosphere.subscribe(holonID, 'canvas', (entry: any, key?: string) => {
                if (entry && key === 'drawings') {
                    if (entry.updatedAt && entry.updatedAt <= drawingsUpdatedAt) return; // ignore older updates
                    if (Array.isArray(entry.data)) {
                        drawings = entry.data;
                        drawingsUpdatedAt = entry.updatedAt || Date.now();
                    }
                }
            }).then((sub: { unsubscribe: () => void }) => {
                drawingsOff = sub.unsubscribe;
            }).catch(console.error);
        }

        return () => {
            if (drawingsOff) drawingsOff();
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
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

    // Add the getColorFromCategory function to match Tasks component
    function getColorFromCategory(category: string | undefined, type: string = 'task') {
        if (!category) {
            // Default colors based on type
            switch (type) {
                case 'event':
                    return "hsl(280, 70%, 85%)"; // Purple for events
                case 'quest':
                    return "hsl(200, 70%, 85%)"; // Blue for quests
                default:
                    return "#E5E7EB"; // Gray for tasks
            }
        }

        // For items with categories, generate color but adjust based on type
        let hash = 0;
        for (let i = 0; i < category.length; i++) {
            hash = (hash << 5) - hash + category.charCodeAt(i);
            hash = hash & hash;
        }

        const hue = Math.abs(hash % 360);
        // Adjust saturation and lightness based on type
        switch (type) {
            case 'event':
                return `hsl(${hue}, 85%, 80%)`; // More saturated for events
            case 'quest':
                return `hsl(${hue}, 75%, 82%)`; // Slightly saturated for quests
            default:
                return `hsl(${hue}, 70%, 85%)`; // Original for tasks
        }
    }

    // -------- Move drawings logic --------
    let isMobile = false;

    function hitTestDrawing(point: {x:number;y:number}): number | null {
        // iterate from topmost
        for (let i = drawings.length - 1; i >= 0; i--) {
            const d = drawings[i];
            if (d.type === 'text') {
                const width = (d.text?.length || 4) * (d.fontSize || 16) * 0.6;
                const height = d.fontSize || 16;
                if (point.x >= d.x && point.x <= d.x + width && point.y >= d.y && point.y <= d.y + height) return i;
            } else if (d.type === 'line' && d.points?.length === 2) {
                const [p1,p2] = d.points;
                const dist = distancePointToSegment(point, p1, p2);
                if (dist < 6) return i;
            } else if (d.type === 'path' && d.points?.length>1) {
                for (let j=0;j<d.points.length-1;j++) {
                    if (distancePointToSegment(point, d.points[j], d.points[j+1])<6) return i;
                }
            }
        }
        return null;
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

    <!-- Control Panel -->
    <div class="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <!-- Mobile indicator -->
        {#if isMobile}
            <div class="p-2 bg-yellow-800 bg-opacity-70 rounded-lg text-white text-xs text-center">
                📱 Mobile<br/>
                <span class="text-xs opacity-75">Tap & drag to move tasks</span>
            </div>
        {/if}
        
        <!-- Go to Inbox button -->
        <button 
            class="p-2 bg-blue-800 bg-opacity-70 hover:bg-blue-700 rounded-lg text-white text-opacity-90 hover:text-white transition-colors"
            on:click={goToInbox}
            aria-label="Go to inbox area"
            title="Go to new task inbox"
        >
            📥
        </button>

        <!-- Center on Tasks button -->
        <button 
            class="p-2 bg-gray-800 bg-opacity-50 hover:bg-gray-700 rounded-lg text-white text-opacity-70 hover:text-white hover:text-opacity-90 transition-colors"
            on:click={centerOnTasks}
            aria-label="Center view on tasks"
            title="Center view on tasks"
        >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
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
                    {@const minimapX = (card.x / CANVAS_WIDTH) * 120}
                    {@const minimapY = (card.y / CANVAS_HEIGHT) * 90}
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
            <!-- Saved drawings -->
            {#each drawings as drawing, i}
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
                        font-family="sans-serif"
                        dominant-baseline="hanging"
                    >
                        {drawing.text}
                    </text>
                {/if}
            {/each}
            
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
                on:keydown={handleTextInput}
                class="absolute bg-white border border-gray-300 px-2 py-1 rounded text-black z-20"
                style="left: {textPosition.x}px; 
                       top: {textPosition.y}px;
                       font-size: {currentStroke * 4}px;"
                placeholder="Type text and press Enter"
            />
        {/if}

        <!-- New Task Inbox Area -->
        <div 
            class="absolute border-2 border-dashed border-blue-400 border-opacity-50 rounded-lg bg-blue-400 bg-opacity-10 flex items-center justify-center"
            style="left: {INBOX_CENTER.x - INBOX_WIDTH/2}px; 
                   top: {INBOX_CENTER.y - INBOX_HEIGHT/2}px; 
                   width: {INBOX_WIDTH}px; 
                   height: {INBOX_HEIGHT}px;"
        >
            <div class="text-blue-300 text-opacity-70 text-lg font-medium text-center pointer-events-none select-none">
                📥 New Tasks<br/>
                <span class="text-sm opacity-60">Drag to organize</span>
            </div>
        </div>

        

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


                <div 
                    class="w-80 p-3 rounded-xl shadow-lg transition-all duration-300 border border-transparent hover:border-gray-600 hover:shadow-md transform hover:scale-[1.005] cursor-pointer"
                    style="background-color: {card.quest.status === 'completed'
                        ? '#374151'
                        : getColorFromCategory(card.quest.category, card.quest.type)}; 
                           opacity: {card.quest.status === 'completed' ? '0.7' : card.quest._hologram?.isHologram ? '0.75' : '1'};
                           {card.quest._hologram?.isHologram ? 'border: 2px solid #00BFFF; box-sizing: border-box; box-shadow: 0 0 20px rgba(0, 191, 255, 0.4), inset 0 0 20px rgba(0, 191, 255, 0.1);' : ''}"
                >
                    <!-- Header -->
                    <div class="flex items-center justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <!-- Main Content -->
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <h3 class="text-base font-bold text-gray-800">
                                        {card.quest.title}
                                    </h3>
                                    {#if card.quest.created}
                                        <div class="text-xs text-gray-500 ml-2">
                                            Created: {formatDate(card.quest.created)}
                                        </div>
                                    {/if}
                                    {#if card.quest._hologram?.isHologram}
                                        <button
                                            class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500 bg-opacity-20 text-blue-800 flex-shrink-0 hover:bg-blue-500 hover:bg-opacity-30 transition-colors"
                                            title="Navigate to source task"
                                            on:click|stopPropagation={() => {
                                                if (card.quest._hologram) {
                                                    goto(buildHologramLink(card.quest._hologram));
                                                }
                                            }}
                                        >
                                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                                            </svg>
                                            🔮
                                            <svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                            </svg>
                                        </button>
                                    {/if}
                                    {#if card.quest.type === 'recurring' || card.quest.status === 'recurring' || card.quest.status === 'repeating'}
                                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500 bg-opacity-30 text-purple-800 flex-shrink-0">
                                            🔄
                                        </span>
                                    {/if}
                                </div>
                                {#if card.quest.category}
                                    <div class="mb-2">
                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-black bg-opacity-10 text-gray-700">
                                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M11.03 8h-6.06l-3 8h6.06l3-8zm1.94 0l3 8h6.06l-3-8h-6.06zm1.03-2h4.03l3-2h-4.03l-3 2zm-8 0h4.03l-3-2h-4.03l3 2z"/>
                                            </svg>
                                            {card.quest.category}
                                        </span>
                                    </div>
                                {/if}
                                {#if card.quest.description}
                                    <p class="text-sm text-gray-700 truncate">
                                        {card.quest.description}
                                    </p>
                                {/if}
                            </div>
                        </div>

                        <!-- Right Side Meta Info -->
                        <div class="flex items-center gap-3 flex-shrink-0 text-sm">
                            {#if card.quest.location}
                                <div class="flex items-center gap-1 text-gray-600">
                                    <span class="text-xs">📍</span>
                                    <span class="truncate max-w-16 text-xs">{card.quest.location.split(",")[0]}</span>
                                </div>
                            {/if}

                            {#if card.quest.participants?.length > 0}
                                <div class="flex items-center gap-1">
                                    <div class="flex -space-x-1 relative group" title={card.quest.participants.map(p => `${p.firstName || p.username} ${p.lastName ? p.lastName[0] + '.' : ''}`).join(', ')}>
                                        {#each card.quest.participants.slice(0, 2) as participant}
                                            <div class="relative">
                                                <img
                                                    class="w-5 h-5 rounded-full border border-white shadow-sm"
                                                    src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
                                                    alt={`${participant.firstName || participant.username} ${participant.lastName ? participant.lastName[0] + '.' : ''}`}
                                                />
                                            </div>
                                        {/each}
                                        {#if card.quest.participants.length > 2}
                                            <div class="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-xs border border-white shadow-sm text-white font-medium">
                                                <span>+{card.quest.participants.length - 2}</span>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/if}

                            {#if card.quest.when}
                                <div class="text-xs font-medium text-gray-700 whitespace-nowrap">
                                    <div class="text-xs text-gray-600 mb-1">{formatDate(card.quest.when)}</div>
                                    {formatTime(card.quest.when)}
                                    {#if card.quest.ends}<br/>{formatTime(card.quest.ends)}{/if}
                                </div>
                            {/if}

                            {#if card.quest.appreciation?.length > 0}
                                <div class="flex items-center gap-1 text-gray-600" title={`${card.quest.appreciation.length} appreciations`}>
                                    <span class="text-xs">👍</span>
                                    <span class="text-xs font-medium">{card.quest.appreciation.length}</span>
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>


            </div>
        {/each}

    </div>

    <!-- Dependency arrows - outside canvas, using DOM coordinates -->
    <svg 
        class="absolute pointer-events-none inset-0"
        style="width: 100%; height: 100%;"
        xmlns="http://www.w3.org/2000/svg"
    >
        <defs>
            {#each questCards as card (card.key)}
                {#if card.quest.dependsOn && card.quest.dependsOn.length > 0}
                    {#each card.quest.dependsOn as dependencyId}
                        <marker 
                            id="arrowhead-{card.key}-{dependencyId}"
                            markerWidth="10" 
                            markerHeight="7" 
                            refX="9" 
                            refY="3.5" 
                            orient="auto"
                        >
                            <polygon 
                                points="0 0, 10 3.5, 0 7" 
                                fill="#3B82F6" 
                                opacity="0.8"
                            />
                        </marker>
                    {/each}
                {/if}
            {/each}
        </defs>

        <!-- Force reactivity on pan, zoom, and drag -->
        {#key `${pan.x}-${pan.y}-${zoom}-${draggedCardVisuals?.key}-${draggedCardVisuals?.x}-${draggedCardVisuals?.y}-${measuredCardRects.size}`}
            {#each questCards as card (card.key)}
                {#if card.quest.dependsOn && card.quest.dependsOn.length > 0}
                    {#each card.quest.dependsOn as dependencyId}
                        {@const dependencyCard = questCards.find(c => c.key === dependencyId)}
                        {#if dependencyCard}
                            <!-- Get actual DOM positions with drag updates -->
                            {@const depMeasured = getCardPosition(dependencyCard.key)}
                            {@const cardMeasured = getCardPosition(card.key)}
                            
                            {#if depMeasured && cardMeasured}
                                <!-- Use direct DOM positions - no displacement calculation needed -->
                                {@const depX = depMeasured.x}
                                {@const depY = depMeasured.y}
                                {@const cardX = cardMeasured.x}
                                {@const cardY = cardMeasured.y}
                                
                                <!-- Simple DOM coordinate arrows -->
                                {@const startX = depX + depMeasured.width / 2}
                                {@const startY = depY + depMeasured.height}
                                {@const endX = cardX + cardMeasured.width / 2}
                                {@const endY = cardY}
                                
                                <!-- Simple curved arrow -->
                                {@const deltaY = Math.abs(endY - startY)}
                                {@const controlOffset = Math.max(30, Math.min(80, deltaY / 3))}
                                {@const control1X = startX}
                                {@const control1Y = startY + controlOffset}
                                {@const control2X = endX}
                                {@const control2Y = endY - controlOffset}

                                <path 
                                    d="M {startX} {startY} C {control1X} {control1Y}, {control2X} {control2Y}, {endX} {endY}"
                                    stroke="#3B82F6" 
                                    stroke-width="2" 
                                    fill="none" 
                                    opacity="0.8"
                                    marker-end="url(#arrowhead-{card.key}-{dependencyId})"
                                />
                            {/if}
                        {/if}
                    {/each}
                {/if}
            {/each}
        {/key}
    </svg>
</div>

<style>
    .grid-background {
        background-image: 
            linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
        background-size: 40px 40px;
    }

    .task-card {
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-font-smoothing: subpixel-antialiased;
        position: relative; /* Ensure dots are positioned relative to the card */
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
        
        /* Improve touch targets on mobile */
        .task-card > div {
            min-height: 44px; /* iOS minimum touch target */
        }
        
        /* Prevent zoom on double tap */
        :global(*) {
            touch-action: manipulation;
        }
    }
</style> 