<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import type { HoloSphere } from "holosphere";
  import DraggableWindow from './DraggableWindow.svelte';

  export let roomId: string;
  export let show = false;
  export let floating = true;
  export let title = '';
  export let onClose: (() => void) | null = null;

  // Floating window configuration
  let windowWidth = 600;
  let windowHeight = 450;
  let initialX = window?.innerWidth ? window.innerWidth - 620 : 100;
  let initialY = 100;
  
  // Track current window dimensions for video stream optimization
  let currentWidth = windowWidth;
  let currentHeight = windowHeight;

  // Media elements
  let localVideoElement: HTMLVideoElement;
  let localStream: MediaStream | null = null;
  let remoteStreams = new Map<string, MediaStream>();
  let containerElement: HTMLElement;

  // Connection management
  let peerConnections = new Map<string, RTCPeerConnection>();
  let pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  let connectionStates = new Map<string, string>();
  let connectionAttempts = new Map<string, boolean>();

  // User management
  let myUserId = `user_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
  let connectedPeers: string[] = [];

  // UI state
  let isAudioEnabled = true;
  let isVideoEnabled = true;
  let connectionStatus = 'Initializing...';

  // Holosphere signaling
  let signalLens: string;
  let userLens: string;
  let unsubscribeSignals: (() => void) | null = null;
  let unsubscribeUsers: (() => void) | null = null;

  // Cleanup functions
  let cleanupFunctions: (() => void)[] = [];

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  };

  function log(message: string) {
    console.log(`[VideoCall] ${message}`);
  }

  // Initialize holosphere context
  let holosphere: HoloSphere;
  let signalingAvailable = false;
  try {
    holosphere = getContext('holosphere');
    if (holosphere) {
      signalingAvailable = true;
      log('Holosphere signaling available via Nostr');
    }
  } catch (e) {
    log('Failed to get holosphere context');
  }

  // Calculate total peer count for grid layout (only active video streams: local + remote)
  $: totalPeerCount = 1 + remoteStreams.size;
  
  // React to window size changes and update video constraints
  $: if (floating && (currentWidth || currentHeight) && localStream) {
    updateVideoConstraints();
  }

  // Window management functions
  function handleClose() {
    leaveRoom();
    show = false;
    if (onClose) {
      onClose();
    }
  }

  function handleCloseCall() {
    leaveRoom();
    show = false;
    if (onClose) {
      onClose();
    }
  }

  // Update initial position when window resizes
  function updatePosition() {
    if (window?.innerWidth) {
      initialX = Math.min(initialX, window.innerWidth - windowWidth);
      initialY = Math.min(initialY, window.innerHeight - windowHeight);
    }
  }

  // Generate window title
  $: windowTitle = title || `Video Call - Room: ${roomId}`;

  // Video constraint optimization
  function getOptimalVideoConstraints() {
    // Get container dimensions
    let containerWidth = floating ? currentWidth : (containerElement ? containerElement.clientWidth : window.innerWidth);
    let containerHeight = floating ? currentHeight : (containerElement ? containerElement.clientHeight : window.innerHeight);
    
    // Account for padding, controls, and grid layout
    const paddingAndControls = 120;
    containerWidth = Math.max(320, containerWidth - paddingAndControls);
    containerHeight = Math.max(240, containerHeight - paddingAndControls);
    
    // Calculate optimal resolution based on container size and peer count
    const peerCount = Math.max(1, totalPeerCount);
    let targetWidth, targetHeight;
    
    if (peerCount === 1) {
      // Single video - use most of container space
      targetWidth = Math.min(1920, containerWidth);
      targetHeight = Math.min(1080, containerHeight);
    } else if (peerCount <= 4) {
      // 2-4 videos - moderate resolution
      targetWidth = Math.min(960, containerWidth / (peerCount <= 2 ? 2 : 2));
      targetHeight = Math.min(540, containerHeight / (peerCount <= 2 ? 1 : 2));
    } else {
      // Many videos - lower resolution to save bandwidth
      const cols = Math.ceil(Math.sqrt(peerCount));
      const rows = Math.ceil(peerCount / cols);
      targetWidth = Math.min(640, containerWidth / cols);
      targetHeight = Math.min(360, containerHeight / rows);
    }
    
    // Ensure 16:9 aspect ratio preference
    if (targetWidth / targetHeight > 16/9) {
      targetWidth = Math.floor(targetHeight * 16/9);
    } else {
      targetHeight = Math.floor(targetWidth * 9/16);
    }
    
    log(`🎯 Optimal video constraints: ${targetWidth}x${targetHeight} for ${peerCount} peers`);
    
    return {
      width: { ideal: targetWidth, max: targetWidth * 1.5 },
      height: { ideal: targetHeight, max: targetHeight * 1.5 },
      frameRate: { ideal: peerCount > 4 ? 15 : 30, max: 30 }
    };
  }

  async function updateVideoConstraints() {
    if (!localStream) return;
    
    try {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        const constraints = getOptimalVideoConstraints();
        await videoTrack.applyConstraints(constraints);
        log('Updated video constraints for window resize');
      }
    } catch (error) {
      log(`Failed to update video constraints: ${error}`);
    }
  }

  async function initializeLocalMedia() {
    try {
      const videoConstraints = getOptimalVideoConstraints();
      localStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      if (localVideoElement) {
        localVideoElement.srcObject = localStream;
      }

      log('Local media initialized');
    } catch (error) {
      log(`Failed to get local media: ${error}`);
      throw new Error('Camera/microphone access denied');
    }
  }

  // Initialize holosphere signaling
  async function setupSignaling() {
    if (!holosphere || !roomId) return;

    // Use room-specific lenses for signaling
    signalLens = `video_signals_${roomId}`;
    userLens = `video_users_${roomId}`;

    log(`📡 Signaling setup complete for room: ${roomId}`);
  }

  // Create a new peer connection with comprehensive handling
  async function createPeerConnection(peerId: string) {
    if (peerConnections.has(peerId)) {
      log(`Peer connection already exists for ${peerId.substring(0, 8)}`);
      return;
    }

    if (connectionAttempts.get(peerId)) {
      log(`Connection attempt already in progress for ${peerId.substring(0, 8)}`);
      return;
    }

    log(`Creating peer connection for ${peerId.substring(0, 8)}`);
    connectionAttempts.set(peerId, true);

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.set(peerId, pc);
    connectionStates.set(peerId, 'new');

    // Add local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream!);
      });
    }

    // Handle incoming streams
    pc.ontrack = (event) => {
      log(`Received remote stream from ${peerId}`);
      if (event.streams[0]) {
        remoteStreams.set(peerId, event.streams[0]);
        // Trigger reactivity by creating new Map
        remoteStreams = new Map(remoteStreams);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      connectionStates.set(peerId, state);
      log(`Connection with ${peerId.substring(0, 8)}: ${state}`);

      if (state === 'connected') {
        if (!connectedPeers.includes(peerId)) {
          connectedPeers = [...connectedPeers, peerId];
          log(`Successfully connected to ${peerId.substring(0, 8)}`);
        }
      } else if (state === 'disconnected' || state === 'failed') {
        connectedPeers = connectedPeers.filter(p => p !== peerId);
        if (state === 'failed') {
          log(`Connection failed with ${peerId.substring(0, 8)}, will retry`);
          setTimeout(() => recreatePeerConnection(peerId), 2000);
        }
      }
    };

    // Handle ICE connection state
    pc.oniceconnectionstatechange = () => {
      log(`ICE state with ${peerId.substring(0, 8)}: ${pc.iceConnectionState}`);
    };

    // Initiate connection if we should (based on user ID comparison)
    if (shouldInitiateConnection(myUserId, peerId)) {
      log(`Initiating offer to ${peerId.substring(0, 8)}`);
      // Use Promise.resolve to ensure this runs after current event loop
      Promise.resolve().then(() => createOffer(peerId));
    } else {
      log(`Waiting for offer from ${peerId.substring(0, 8)}`);
    }

    // Fallback: if connection is still in "new" state after 3 seconds, force an offer
    setTimeout(() => {
      if (pc.signalingState === 'stable' && pc.connectionState === 'new') {
        log(`Forcing offer creation for stuck connection to ${peerId.substring(0, 8)}`);
        createOffer(peerId);
      }
    }, 3000);
  }

  function shouldInitiateConnection(userId1: string, userId2: string): boolean {
    // Use deterministic comparison to avoid race conditions
    return userId1.localeCompare(userId2) < 0;
  }

  async function createOffer(peerId: string) {
    const pc = peerConnections.get(peerId);
    if (!pc) {
      log(`No peer connection found for ${peerId.substring(0, 8)} when creating offer`);
      return;
    }

    log(`Creating offer for ${peerId.substring(0, 8)}, signaling state: ${pc.signalingState}`);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await pc.setLocalDescription(offer);
      sendSignal(peerId, 'offer', offer);
      log(`Sent offer to ${peerId.substring(0, 8)}`);
    } catch (error) {
      log(`Failed to create offer for ${peerId.substring(0, 8)}: ${error}`);
    }
  }

  async function handleOffer(fromUserId: string, offer: RTCSessionDescriptionInit, pc: RTCPeerConnection) {
    log(`Handling offer from ${fromUserId.substring(0, 8)}, current state: ${pc.signalingState}`);

    // Handle "glare" condition - both peers sent offers simultaneously
    if (pc.signalingState === 'have-local-offer') {
      log(`Glare condition detected with ${fromUserId.substring(0, 8)}`);

      // Use polite/impolite pattern - alphabetically first peer is "polite" (gives way)
      if (shouldInitiateConnection(myUserId, fromUserId)) {
        log(`I'm polite, rolling back my offer and accepting theirs`);
        // Rollback our offer and accept theirs
        await pc.setLocalDescription({type: 'rollback'});
      } else {
        log(`I'm impolite, ignoring their offer and keeping mine`);
        return; // Ignore their offer, they should accept ours
      }
    } else if (pc.signalingState !== 'stable') {
      log(`Signaling state not stable (${pc.signalingState}), recreating connection`);
      await recreatePeerConnection(fromUserId);
      const newPc = peerConnections.get(fromUserId);
      if (!newPc) return;
      pc = newPc;
    }

    try {
      // Validate the offer data
      if (!offer || !offer.sdp || typeof offer.sdp !== 'string') {
        throw new Error(`Invalid offer data: ${JSON.stringify(offer)}`);
      }

      if (!offer.sdp.startsWith('v=')) {
        throw new Error(`Invalid SDP format - missing v= line. SDP starts with: ${offer.sdp.substring(0, 50)}...`);
      }

      log(`Received offer with SDP length: ${offer.sdp.length}`);

      // Ensure the offer has the correct format
      const remoteOffer = new RTCSessionDescription({
        type: 'offer',
        sdp: offer.sdp
      });

      await pc.setRemoteDescription(remoteOffer);
      log(`Set remote description for ${fromUserId.substring(0, 8)}`);
      await processPendingCandidates(fromUserId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignal(fromUserId, 'answer', answer);
      log(`Sent answer to ${fromUserId.substring(0, 8)}`);
    } catch (error) {
      log(`Failed to handle offer from ${fromUserId.substring(0, 8)}: ${error}`);
      // Try to recover by recreating the connection
      setTimeout(() => recreatePeerConnection(fromUserId), 1000);
    }
  }

  async function handleAnswer(fromUserId: string, answer: RTCSessionDescriptionInit, pc: RTCPeerConnection) {
    log(`Handling answer from ${fromUserId.substring(0, 8)}`);

    if (pc.signalingState === 'have-local-offer') {
      try {
        // Ensure the answer has the correct format
        const remoteAnswer = new RTCSessionDescription({
          type: 'answer',
          sdp: answer.sdp
        });

        await pc.setRemoteDescription(remoteAnswer);
        await processPendingCandidates(fromUserId, pc);
        log(`Set remote description for ${fromUserId.substring(0, 8)}`);
      } catch (error) {
        log(`Failed to handle answer from ${fromUserId.substring(0, 8)}: ${error}`);
      }
    } else {
      log(`Unexpected answer in state ${pc.signalingState}`);
    }
  }

  async function handleIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit, pc: RTCPeerConnection) {
    if (pc.remoteDescription) {
      await pc.addIceCandidate(candidate);
      log(`Added ICE candidate from ${fromUserId.substring(0, 8)}`);
    } else {
      log(`Queuing ICE candidate from ${fromUserId.substring(0, 8)} (no remote description)`);
      if (!pendingCandidates.has(fromUserId)) {
        pendingCandidates.set(fromUserId, []);
      }
      pendingCandidates.get(fromUserId)!.push(candidate);
    }
  }

  async function processPendingCandidates(peerId: string, pc: RTCPeerConnection) {
    const candidates = pendingCandidates.get(peerId);
    if (!candidates || candidates.length === 0) return;

    log(`Processing ${candidates.length} pending ICE candidates for ${peerId.substring(0, 8)}`);

    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        log(`Failed to add pending candidate: ${error}`);
      }
    }

    pendingCandidates.delete(peerId);
  }

  async function recreatePeerConnection(peerId: string) {
    log(`Recreating peer connection for ${peerId.substring(0, 8)}`);

    const oldPc = peerConnections.get(peerId);
    if (oldPc) {
      oldPc.close();
      peerConnections.delete(peerId);
    }

    connectionStates.delete(peerId);
    pendingCandidates.delete(peerId);
    connectionAttempts.delete(peerId);

    // Wait a bit before recreating to avoid rapid recreation loops
    setTimeout(() => {
      if (!peerConnections.has(peerId)) {
        createPeerConnection(peerId);
      }
    }, 1000);
  }

  async function joinRoom() {
    if (!holosphere) return;

    // Announce presence
    const presence = {
      id: myUserId,
      odysId: myUserId,
      online: true,
      joinedAt: Date.now(),
      roomId: roomId
    };

    await holosphere.put(roomId, userLens, presence);
    log('Announced presence');

    // Listen for other users via holosphere subscription
    const userSub = await holosphere.subscribe(roomId, userLens, (userData: any) => {
      if (!userData || !userData.online || userData.id === myUserId) return;

      log(`User ${(userData.id || '').substring(0, 8)} joined`);

      if (!peerConnections.has(userData.id)) {
        createPeerConnection(userData.id);
      }
    });
    unsubscribeUsers = userSub?.unsubscribe || null;

    // Listen for signaling messages via holosphere subscription
    const signalSub = await holosphere.subscribe(roomId, signalLens, (message: any) => {
      // Only process messages addressed to us
      if (!message || message.msgTo !== myUserId) return;

      log(`Signal received from ${message.msgFrom?.substring(0, 8)}: ${message.msgType}`);

      // Parse the message data
      let parsedData;
      try {
        parsedData = JSON.parse(message.msgData || '{}');
      } catch (e) {
        log('Failed to parse message data');
        return;
      }

      // Convert to standard format
      const compatMessage = {
        from: message.msgFrom,
        to: message.msgTo,
        type: message.msgType,
        data: parsedData,
        timestamp: message.timestamp
      };

      handleSignalingMessage(compatMessage);
    });
    unsubscribeSignals = signalSub?.unsubscribe || null;

    cleanupFunctions.push(() => {
      if (unsubscribeUsers) unsubscribeUsers();
      if (unsubscribeSignals) unsubscribeSignals();
    });
  }

  async function handleSignalingMessage(message: any) {
    const { from: fromUserId, type, data } = message;
    const pc = peerConnections.get(fromUserId);

    if (!pc && type !== 'ice-candidate') {
      log(`Creating peer connection for incoming ${type} from ${fromUserId.substring(0, 8)}`);
      await createPeerConnection(fromUserId);
    }

    if (type === 'ice-candidate' && !pc) {
      // Queue ICE candidates that arrive before peer connection
      log(`Queuing ICE candidate from ${fromUserId.substring(0, 8)}`);
      if (!pendingCandidates.has(fromUserId)) {
        pendingCandidates.set(fromUserId, []);
      }
      pendingCandidates.get(fromUserId)!.push(data);
      return;
    }

    const peerConnection = peerConnections.get(fromUserId);
    if (!peerConnection) return;

    try {
      switch (type) {
        case 'offer':
          await handleOffer(fromUserId, data, peerConnection);
          break;
        case 'answer':
          await handleAnswer(fromUserId, data, peerConnection);
          break;
        case 'ice-candidate':
          await handleIceCandidate(fromUserId, data, peerConnection);
          break;
        default:
          log(`Unknown message type: ${type}`);
      }
    } catch (error) {
      log(`Error handling ${type} from ${fromUserId.substring(0, 8)}: ${error}`);
    }
  }

  async function sendSignal(toUserId: string, type: string, data: any) {
    if (!holosphere) return;

    const messageId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Clean the data to ensure it's properly serialized
    let cleanData = data;
    if (type === 'offer' || type === 'answer') {
      cleanData = {
        type: data.type,
        sdp: data.sdp
      };
    }

    // Create signal message
    const message = {
      id: messageId,
      msgFrom: myUserId,
      msgTo: toUserId,
      msgType: type,
      msgData: JSON.stringify(cleanData),
      timestamp: Date.now()
    };

    log(`Sending ${type} to ${toUserId.substring(0, 8)}`);
    await holosphere.put(roomId, signalLens, message);
  }

  function toggleAudio() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isAudioEnabled = audioTrack.enabled;
      log(`Audio ${isAudioEnabled ? 'enabled' : 'disabled'}`);
    }
  }

  function toggleVideo() {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      isVideoEnabled = videoTrack.enabled;
      log(`Video ${isVideoEnabled ? 'enabled' : 'disabled'}`);
    }
  }


  async function leaveRoom() {
    log('Leaving room');

    // Remove presence via holosphere
    if (holosphere) {
      try {
        await holosphere.delete(roomId, userLens, myUserId);
      } catch (e) {
        log('Failed to remove presence');
      }
    }

    // Close all peer connections
    peerConnections.forEach((pc, peerId) => {
      log(`Closing connection to ${peerId.substring(0, 8)}`);
      pc.close();
    });
    peerConnections.clear();
    connectionStates.clear();
    pendingCandidates.clear();
    connectionAttempts.clear();

    // Clear remote streams
    remoteStreams.clear();
    remoteStreams = new Map(remoteStreams);

    // Stop local media
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    // Call cleanup functions
    cleanupFunctions.forEach(cleanup => cleanup());
    cleanupFunctions = [];
  }

  onMount(async () => {
    log(`🚀 Video call component mounted for room: ${roomId}`);

    if (!holosphere) {
      // Video call signaling not available with current backend
      connectionStatus = 'Video calls temporarily unavailable';
      log('❌ Video call signaling not available - holosphere not initialized');
      return;
    }

    // Only set up signaling, don't initialize media until video window opens
    if (signalingAvailable) {
      await setupSignaling();
      connectionStatus = 'Ready to start call';
    }
  });

  // Cleanup on component destroy
  onDestroy(() => {
    leaveRoom();
  });

  // Update local video when stream changes
  $: if (localVideoElement && localStream) {
    localVideoElement.srcObject = localStream;
  }

  // Initialize video and camera ONLY when show becomes true (user opens video window)
  $: if (show && !localStream && typeof window !== 'undefined') {
    (async () => {
      try {
        log(`🚀 Video window opened - requesting camera access for room: ${roomId} as ${myUserId.substring(0, 12)}`);

        if (!holosphere || !signalingAvailable) {
          // Video call signaling not available with current backend
          connectionStatus = 'Video calls temporarily unavailable';
          log('❌ Video call signaling not available - holosphere not initialized');
          return;
        }

        // Camera permission is requested HERE when video window opens
        await initializeLocalMedia();
        if (!signalLens || !userLens) {
          await setupSignaling();
        }
        await joinRoom();
        connectionStatus = 'Connected to room';
        log('✅ Successfully joined room and started peer discovery');
      } catch (error) {
        connectionStatus = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        log(`❌ Failed to initialize: ${error}`);
      }
    })();
  }

  // Clean up media when video window is closed
  $: if (!show && localStream) {
    log('🔒 Video window closed - stopping camera and leaving room');
    leaveRoom();
  }

  // Listen for window resize and close events
  onMount(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updatePosition);
    }
    document.addEventListener('closeCall', handleCloseCall);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', updatePosition);
    }
    document.removeEventListener('closeCall', handleCloseCall);
  });
</script>

{#if show}
  {#if floating}
    <!-- Floating draggable window mode -->
    <DraggableWindow 
      title={windowTitle}
      bind:width={currentWidth}
      bind:height={currentHeight}
      {initialX}
      {initialY}
      minWidth={320}
      minHeight={240}
      maxWidth={window?.innerWidth ? window.innerWidth - 40 : 1200}
      maxHeight={window?.innerHeight ? window.innerHeight - 40 : 800}
      on:close={handleClose}
    >
      <div class="video-container floating" bind:this={containerElement}>
        <div class="videos" data-peer-count={totalPeerCount}>
          <!-- Local Video -->
          <div class="video-wrapper local">
            <video bind:this={localVideoElement} autoplay muted playsinline class:video-off={!isVideoEnabled}>
              <track kind="captions" />
            </video>
            {#if !isVideoEnabled}
              <div class="video-off-indicator">📹</div>
            {/if}
          </div>

          <!-- Remote Videos -->
          {#each Array.from(remoteStreams.entries()) as [peerId, stream] (peerId)}
            <div class="video-wrapper remote">
              <video srcObject={stream} autoplay playsinline>
                <track kind="captions" />
              </video>
            </div>
          {/each}
        </div>

        <div class="controls">
          <button
            class="control-btn"
            class:muted={!isAudioEnabled}
            on:click={toggleAudio}
            disabled={!localStream}
            title={isAudioEnabled ? 'Mute' : 'Unmute'}
          >
            {isAudioEnabled ? '🎤' : '🔇'}
          </button>

          <button
            class="control-btn"
            class:muted={!isVideoEnabled}
            on:click={toggleVideo}
            disabled={!localStream}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? '📹' : '📵'}
          </button>

        </div>
      </div>
    </DraggableWindow>
  {:else}
    <!-- Full-screen/embedded mode -->
    <div class="video-call-fullscreen">
      <div class="video-container" bind:this={containerElement}>
        <div class="videos" data-peer-count={totalPeerCount}>
          <!-- Local Video -->
          <div class="video-wrapper local">
            <video bind:this={localVideoElement} autoplay muted playsinline class:video-off={!isVideoEnabled}>
              <track kind="captions" />
            </video>
            {#if !isVideoEnabled}
              <div class="video-off-indicator">📹</div>
            {/if}
          </div>

          <!-- Remote Videos -->
          {#each Array.from(remoteStreams.entries()) as [peerId, stream] (peerId)}
            <div class="video-wrapper remote">
              <video srcObject={stream} autoplay playsinline>
                <track kind="captions" />
              </video>
            </div>
          {/each}
        </div>

        <div class="controls">
          <button
            class="control-btn"
            class:muted={!isAudioEnabled}
            on:click={toggleAudio}
            disabled={!localStream}
            title={isAudioEnabled ? 'Mute' : 'Unmute'}
          >
            {isAudioEnabled ? '🎤' : '🔇'}
          </button>

          <button
            class="control-btn"
            class:muted={!isVideoEnabled}
            on:click={toggleVideo}
            disabled={!localStream}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? '📹' : '📵'}
          </button>

        </div>
      </div>
      
      {#if onClose}
        <button class="close-fullscreen" on:click={handleClose}>
          ✕ Close
        </button>
      {/if}
    </div>
  {/if}
{/if}


<style>
  .video-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #000;
    color: white;
    min-height: 0;
  }

  .video-container.floating {
    height: 100%;
    max-height: 100%;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .videos {
    flex: 1;
    padding: 0.5rem;
    padding-bottom: 70px;
    display: grid;
    gap: 0.5rem;
    width: 100%;
    min-height: 0;
    max-height: 100%;
    overflow: hidden;
    place-items: stretch;
    align-content: stretch;
    box-sizing: border-box;
  }

  .video-wrapper {
    position: relative;
    background: #333;
    border-radius: 8px;
    overflow: hidden;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-wrapper video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .video-wrapper.local video {
    transform: scaleX(-1);
  }

  .video-wrapper.local video.video-off {
    display: none;
  }

  .video-off-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 3rem;
    opacity: 0.7;
  }

  .controls {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;
    background: rgba(0,0,0,0.7);
    padding: 0.5rem;
    border-radius: 25px;
    backdrop-filter: blur(10px);
    z-index: 10;
    pointer-events: auto;
  }

  .control-btn {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    color: white;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(10px);
  }

  .control-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .control-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.3);
    transform: scale(1.1);
  }

  .control-btn:global(.muted) {
    background: rgba(220, 38, 38, 0.7);
  }

  .control-btn:global(.muted):hover:not(:disabled) {
    background: rgba(220, 38, 38, 0.9);
  }



  /* Dynamic grid layouts */
  .videos[data-peer-count="1"] {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  .videos[data-peer-count="2"] {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }

  .videos[data-peer-count="3"] {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
  
  .videos[data-peer-count="3"] .video-wrapper:first-child {
    grid-column: 1 / -1;
  }

  .videos[data-peer-count="4"] {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }

  .videos[data-peer-count="5"],
  .videos[data-peer-count="6"] {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }

  .videos[data-peer-count="7"],
  .videos[data-peer-count="8"],
  .videos[data-peer-count="9"] {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }

  .videos[data-peer-count="10"],
  .videos[data-peer-count="11"],
  .videos[data-peer-count="12"] {
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }

  .videos:not([data-peer-count="1"]):not([data-peer-count="2"]):not([data-peer-count="3"]):not([data-peer-count="4"]):not([data-peer-count="5"]):not([data-peer-count="6"]):not([data-peer-count="7"]):not([data-peer-count="8"]):not([data-peer-count="9"]):not([data-peer-count="10"]):not([data-peer-count="11"]):not([data-peer-count="12"]) {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    grid-auto-rows: 1fr;
    grid-template-rows: repeat(auto-fit, 1fr);
  }

  .video-call-fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 9999;
    background: #000;
  }

  .close-fullscreen {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border: none;
    padding: 10px 15px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    z-index: 10001;
    backdrop-filter: blur(10px);
    transition: background 0.2s;
  }

  .close-fullscreen:hover {
    background: rgba(0, 0, 0, 0.9);
  }

  /* Mobile responsive adjustments */
  @media (max-width: 768px) {
    .controls {
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.75rem;
    }

    .control-btn {
      flex: 1;
      min-width: 80px;
      font-size: 0.8rem;
    }
  }

  /* Global styles to ensure proper z-index layering */
  :global(.draggable-window) {
    z-index: 10000;
  }
</style>