<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import type { HoloSphere } from "holosphere";

  export let roomId: string;

  // Media elements
  let localVideoElement: HTMLVideoElement;
  let localStream: MediaStream | null = null;
  let remoteStreams = new Map<string, MediaStream>();
  
  // Connection management
  let peerConnections = new Map<string, RTCPeerConnection>();
  let pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  let connectionStates = new Map<string, string>();
  let connectionAttempts = new Map<string, boolean>();
  let processedMessages = new Set<string>();
  
  // User management
  let myUserId = `user_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
  let connectedPeers: string[] = [];
  
  // UI state
  let isAudioEnabled = true;
  let isVideoEnabled = true;
  let connectionStatus = 'Initializing...';
  let debugLogs: string[] = [];
  let showDebug = false;
  
  // Gun instance
  let gun: any;
  let roomRef: any;
  let signalRef: any;
  let userRef: any;
  
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
    const timestamp = new Date().toLocaleTimeString();
    debugLogs = [`${timestamp}: ${message}`, ...debugLogs.slice(0, 29)];
    console.log(`[VideoCall] ${message}`);
  }

  // Initialize holosphere context
  let holosphere: HoloSphere;
  try {
    holosphere = getContext('holosphere');
    gun = holosphere?.gun;
  } catch (e) {
    log('❌ Failed to get holosphere context');
  }

  onMount(async () => {
    log(`🚀 Starting video call in room: ${roomId} as ${myUserId.substring(0, 12)}`);
    
    if (!gun) {
      connectionStatus = 'Error: No Gun connection available';
      log('❌ Gun instance not available');
      return;
    }

    try {
      await initializeRoom();
      await initializeLocalMedia();
      await joinRoom();
      connectionStatus = 'Connected to room';
      log('✅ Successfully joined room');
    } catch (error) {
      connectionStatus = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      log(`❌ Failed to initialize: ${error}`);
    }
  });

  async function initializeRoom() {
    const roomKey = `vroom_${roomId}`;
    roomRef = gun.get(roomKey);
    signalRef = roomRef.get('signals');
    userRef = roomRef.get('users');
    
    log(`🏠 Initialized room: ${roomKey}`);
  }

  async function initializeLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 }, 
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      
      if (localVideoElement) {
        localVideoElement.srcObject = localStream;
      }
      
      log('📹 Local media initialized');
    } catch (error) {
      log(`❌ Failed to get local media: ${error}`);
      throw new Error('Camera/microphone access denied');
    }
  }

  async function joinRoom() {
    // Announce presence
    const presence = {
      userId: myUserId,
      online: true,
      joinedAt: Date.now(),
      roomId: roomId
    };
    
    userRef.get(myUserId).put(presence);
    log(`📢 Announced presence`);

    // Listen for other users
    const userListener = userRef.map().on((userData: any, userId: string) => {
      if (!userData || !userData.online || userData.userId === myUserId) return;
      
      log(`👤 User ${userData.userId.substring(0, 8)}: ${userData.online ? 'joined' : 'left'}`);
      log(`🔤 Should I initiate to ${userData.userId.substring(0, 8)}? "${myUserId}" < "${userData.userId}" = ${myUserId.localeCompare(userData.userId) < 0}`);
      
      if (!peerConnections.has(userData.userId)) {
        createPeerConnection(userData.userId);
      }
    });

    // Listen for signaling messages
    const signalListener = signalRef.get(myUserId).map().on((message: any, msgId: string) => {
      // Skip if we've already processed this message
      if (processedMessages.has(msgId)) {
        return;
      }
      
      log(`🔄 Raw signal received - msgId: ${msgId}, message: ${message ? 'exists' : 'null'}`);
      
      if (!message || !message.msgFrom || message.msgFrom === myUserId) {
        log(`🚫 Ignoring signal - message: ${!!message}, from: ${message?.msgFrom}, myUserId: ${myUserId}`);
        return;
      }
      
      // Mark as processed to prevent duplicate handling
      processedMessages.add(msgId);
      
      // Parse the message data
      let parsedData;
      try {
        parsedData = JSON.parse(message.msgData || '{}');
      } catch (e) {
        log(`❌ Failed to parse message data: ${e}`);
        return;
      }
      
      // Convert to old format for compatibility
      const compatMessage = {
        from: message.msgFrom,
        to: message.msgTo,
        type: message.msgType,
        data: parsedData,
        timestamp: message.timestamp
      };
      
      log(`📨 Signal from ${compatMessage.from.substring(0, 8)}: ${compatMessage.type} (msgId: ${msgId})`);
      
      // Extra logging for offers and answers
      if (compatMessage.type === 'offer' || compatMessage.type === 'answer') {
        log(`🎯 Processing ${compatMessage.type} from ${compatMessage.from.substring(0, 8)}, SDP length: ${compatMessage.data?.sdp?.length || 'unknown'}`);
      }
      
      handleSignalingMessage(compatMessage);
    });

    cleanupFunctions.push(() => {
      userListener.off();
      signalListener.off();
    });
  }

  async function createPeerConnection(peerId: string) {
    if (peerConnections.has(peerId)) {
      log(`⚠️ Peer connection already exists for ${peerId.substring(0, 8)}`);
      return;
    }

    if (connectionAttempts.get(peerId)) {
      log(`⚠️ Connection attempt already in progress for ${peerId.substring(0, 8)}`);
      return;
    }

    log(`🔗 Creating peer connection for ${peerId.substring(0, 8)}`);
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
      log(`🎥 Received remote stream from ${peerId.substring(0, 8)}`);
      if (event.streams[0]) {
        remoteStreams.set(peerId, event.streams[0]);
        remoteStreams = new Map(remoteStreams); // Trigger reactivity
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
      log(`🔗 Connection with ${peerId.substring(0, 8)}: ${state}`);
      
      if (state === 'connected') {
        if (!connectedPeers.includes(peerId)) {
          connectedPeers = [...connectedPeers, peerId];
          log(`🎉 Successfully connected to ${peerId.substring(0, 8)}`);
        }
      } else if (state === 'disconnected' || state === 'failed') {
        connectedPeers = connectedPeers.filter(p => p !== peerId);
        if (state === 'failed') {
          log(`💥 Connection failed with ${peerId.substring(0, 8)}, will retry`);
          setTimeout(() => recreatePeerConnection(peerId), 2000);
        }
      }
    };

    // Handle ICE connection state
    pc.oniceconnectionstatechange = () => {
      log(`🧊 ICE state with ${peerId.substring(0, 8)}: ${pc.iceConnectionState}`);
    };

    // Initiate connection if we should (based on user ID comparison)
    if (shouldInitiateConnection(myUserId, peerId)) {
      log(`🚀 Initiating offer to ${peerId.substring(0, 8)}`);
      // Use Promise.resolve to ensure this runs after current event loop
      Promise.resolve().then(() => createOffer(peerId));
    } else {
      log(`⏳ Waiting for offer from ${peerId.substring(0, 8)}`);
    }

    // Fallback: if connection is still in "new" state after 3 seconds, force an offer
    setTimeout(() => {
      if (pc.signalingState === 'stable' && pc.connectionState === 'new') {
        log(`⚡ Forcing offer creation for stuck connection to ${peerId.substring(0, 8)}`);
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
      log(`❌ No peer connection found for ${peerId.substring(0, 8)} when creating offer`);
      return;
    }

    log(`🚀 Creating offer for ${peerId.substring(0, 8)}, signaling state: ${pc.signalingState}`);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);
      sendSignal(peerId, 'offer', offer);
      log(`📤 Sent offer to ${peerId.substring(0, 8)}`);
    } catch (error) {
      log(`❌ Failed to create offer for ${peerId.substring(0, 8)}: ${error}`);
    }
  }

  async function handleSignalingMessage(message: any) {
    const { from: fromUserId, type, data } = message;
    const pc = peerConnections.get(fromUserId);

    if (!pc && type !== 'ice-candidate') {
      log(`🔨 Creating peer connection for incoming ${type} from ${fromUserId.substring(0, 8)}`);
      await createPeerConnection(fromUserId);
    }

    if (type === 'ice-candidate' && !pc) {
      // Queue ICE candidates that arrive before peer connection
      log(`📦 Queuing ICE candidate from ${fromUserId.substring(0, 8)}`);
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
          log(`❓ Unknown message type: ${type}`);
      }
    } catch (error) {
      log(`❌ Error handling ${type} from ${fromUserId.substring(0, 8)}: ${error}`);
    }
  }

  async function handleOffer(fromUserId: string, offer: RTCSessionDescriptionInit, pc: RTCPeerConnection) {
    log(`🤝 Handling offer from ${fromUserId.substring(0, 8)}, current state: ${pc.signalingState}`);
    
    // Handle "glare" condition - both peers sent offers simultaneously
    if (pc.signalingState === 'have-local-offer') {
      log(`⚡ Glare condition detected with ${fromUserId.substring(0, 8)}`);
      
      // Use polite/impolite pattern - alphabetically first peer is "polite" (gives way)
      if (shouldInitiateConnection(myUserId, fromUserId)) {
        log(`🤝 I'm polite, rolling back my offer and accepting theirs`);
        // Rollback our offer and accept theirs
        await pc.setLocalDescription({type: 'rollback'});
      } else {
        log(`🚫 I'm impolite, ignoring their offer and keeping mine`);
        return; // Ignore their offer, they should accept ours
      }
    } else if (pc.signalingState !== 'stable') {
      log(`⚠️ Signaling state not stable (${pc.signalingState}), recreating connection`);
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
      
      log(`📋 Received offer with SDP length: ${offer.sdp.length}`);
      
      // Ensure the offer has the correct format
      const remoteOffer = new RTCSessionDescription({
        type: 'offer',
        sdp: offer.sdp
      });
      
      await pc.setRemoteDescription(remoteOffer);
      log(`✅ Set remote description for ${fromUserId.substring(0, 8)}`);
      await processPendingCandidates(fromUserId, pc);
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      sendSignal(fromUserId, 'answer', answer);
      log(`📤 Sent answer to ${fromUserId.substring(0, 8)}`);
    } catch (error) {
      log(`❌ Failed to handle offer from ${fromUserId.substring(0, 8)}: ${error}`);
      // Try to recover by recreating the connection
      setTimeout(() => recreatePeerConnection(fromUserId), 1000);
    }
  }

  async function handleAnswer(fromUserId: string, answer: RTCSessionDescriptionInit, pc: RTCPeerConnection) {
    log(`🤝 Handling answer from ${fromUserId.substring(0, 8)}`);
    
    if (pc.signalingState === 'have-local-offer') {
      try {
        // Ensure the answer has the correct format
        const remoteAnswer = new RTCSessionDescription({
          type: 'answer',
          sdp: answer.sdp
        });
        
        await pc.setRemoteDescription(remoteAnswer);
        await processPendingCandidates(fromUserId, pc);
        log(`✅ Set remote description for ${fromUserId.substring(0, 8)}`);
      } catch (error) {
        log(`❌ Failed to handle answer from ${fromUserId.substring(0, 8)}: ${error}`);
      }
    } else {
      log(`⚠️ Unexpected answer in state ${pc.signalingState}`);
    }
  }

  async function handleIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit, pc: RTCPeerConnection) {
    if (pc.remoteDescription) {
      await pc.addIceCandidate(candidate);
      log(`✅ Added ICE candidate from ${fromUserId.substring(0, 8)}`);
    } else {
      log(`📦 Queuing ICE candidate from ${fromUserId.substring(0, 8)} (no remote description)`);
      if (!pendingCandidates.has(fromUserId)) {
        pendingCandidates.set(fromUserId, []);
      }
      pendingCandidates.get(fromUserId)!.push(candidate);
    }
  }

  async function processPendingCandidates(peerId: string, pc: RTCPeerConnection) {
    const candidates = pendingCandidates.get(peerId);
    if (!candidates || candidates.length === 0) return;

    log(`🗂️ Processing ${candidates.length} pending ICE candidates for ${peerId.substring(0, 8)}`);
    
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        log(`❌ Failed to add pending candidate: ${error}`);
      }
    }
    
    pendingCandidates.delete(peerId);
  }

  async function recreatePeerConnection(peerId: string) {
    log(`🔄 Recreating peer connection for ${peerId.substring(0, 8)}`);
    
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

  function sendSignal(toUserId: string, type: string, data: any) {
    const messageId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Clean the data to ensure it's properly serialized
    let cleanData = data;
    if (type === 'offer' || type === 'answer') {
      cleanData = {
        type: data.type,
        sdp: data.sdp
      };
      log(`📝 Sending ${type} with SDP length: ${data.sdp?.length || 0}`);
    }
    
    // Use Gun-friendly flat structure to prevent corruption
    const message = {
      msgFrom: myUserId,
      msgTo: toUserId,
      msgType: type,
      msgData: JSON.stringify(cleanData),
      timestamp: Date.now()
    };
    
    log(`📤 Storing signal in Gun: ${type} -> ${toUserId.substring(0, 8)}`);
    signalRef.get(toUserId).get(messageId).put(message);
  }

  function toggleAudio() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isAudioEnabled = audioTrack.enabled;
      log(`🎤 Audio ${isAudioEnabled ? 'enabled' : 'disabled'}`);
    }
  }

  function toggleVideo() {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      isVideoEnabled = videoTrack.enabled;
      log(`📹 Video ${isVideoEnabled ? 'enabled' : 'disabled'}`);
    }
  }

  function forceOffers() {
    log('🚀 Force creating offers for all peer connections');
    peerConnections.forEach((pc, peerId) => {
      log(`🔧 Forcing offer for ${peerId.substring(0, 8)}, state: ${pc.signalingState}`);
      if (pc.signalingState === 'stable') {
        createOffer(peerId);
      }
    });
  }

  function debugSignaling() {
    log('🔍 Debugging signaling state');
    peerConnections.forEach((pc, peerId) => {
      log(`👤 Peer ${peerId.substring(0, 8)}:`);
      log(`  - Connection State: ${pc.connectionState}`);
      log(`  - Signaling State: ${pc.signalingState}`);
      log(`  - ICE State: ${pc.iceConnectionState}`);
      log(`  - Local Description: ${pc.localDescription ? 'exists' : 'null'}`);
      log(`  - Remote Description: ${pc.remoteDescription ? 'exists' : 'null'}`);
    });
    
    log(`📦 Pending candidates: ${pendingCandidates.size} peers`);
    pendingCandidates.forEach((candidates, peerId) => {
      log(`  - ${peerId.substring(0, 8)}: ${candidates.length} candidates`);
    });
  }

  function debugGun() {
    log('🔍 Debugging Gun signaling data');
    
    // Check what's actually in the signaling path
    signalRef.get(myUserId).once((allSignals: any) => {
      if (allSignals) {
        const messageCount = Object.keys(allSignals).length;
        log(`📬 Found ${messageCount} messages in my signaling inbox`);
        
        Object.entries(allSignals).forEach(([msgId, message]: [string, any]) => {
          if (message && typeof message === 'object') {
            const type = message.msgType || message.type || 'unknown';
            const from = message.msgFrom?.substring(0, 8) || message.from?.substring(0, 8) || 'unknown';
            log(`  📧 ${msgId}: ${type} from ${from}`);
          }
        });
      } else {
        log('📬 No messages found in signaling inbox');
      }
    });
    
    // Check room users
    userRef.once((allUsers: any) => {
      if (allUsers) {
        const userCount = Object.keys(allUsers).length;
        log(`👥 Found ${userCount} users in room`);
        Object.keys(allUsers).forEach(userId => {
          log(`  👤 ${userId.substring(0, 12)}`);
        });
      }
    });
  }

  function testDirectOffer() {
    log('📨 Testing direct offer transmission');
    
    // Send a simple test offer to the first peer
    const firstPeer = Array.from(peerConnections.keys())[0];
    if (firstPeer) {
      log(`🎯 Sending test offer to ${firstPeer.substring(0, 8)}`);
      
      const testOffer = {
        type: 'offer',
        sdp: 'v=0\r\no=test 123 456 IN IP4 127.0.0.1\r\ns=test\r\nt=0 0\r\n'
      };
      
      sendSignal(firstPeer, 'offer', testOffer);
      log(`✅ Test offer sent with minimal SDP`);
    } else {
      log(`❌ No peers to send test offer to`);
    }
  }

  function leaveRoom() {
    log('👋 Leaving room');
    
    // Remove presence
    if (userRef) {
      userRef.get(myUserId).put(null);
    }
    
    // Close all peer connections
    peerConnections.forEach((pc, peerId) => {
      log(`🔌 Closing connection to ${peerId.substring(0, 8)}`);
      pc.close();
    });
    peerConnections.clear();
    connectionStates.clear();
    pendingCandidates.clear();
    
    // Stop local media
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    // Call cleanup functions
    cleanupFunctions.forEach(cleanup => cleanup());
    cleanupFunctions = [];
    
    // Navigate back
    window.history.back();
  }

  onDestroy(() => {
    leaveRoom();
  });

  // Update local video when stream changes
  $: if (localVideoElement && localStream) {
    localVideoElement.srcObject = localStream;
  }
</script>

<div class="video-container">
  <div class="header">
    <h2>Room: {roomId}</h2>
    <div class="status">{connectionStatus}</div>
    <div class="peer-count">
      {connectedPeers.length} peer{connectedPeers.length !== 1 ? 's' : ''} connected
      {#if peerConnections.size > 0}
        | {peerConnections.size} connection{peerConnections.size !== 1 ? 's' : ''}
      {/if}
    </div>
  </div>

  <div class="videos">
    <!-- Local Video -->
    <div class="video-wrapper local">
      <video bind:this={localVideoElement} autoplay muted playsinline class:video-off={!isVideoEnabled}>
        <track kind="captions" />
      </video>
      <div class="video-label">You ({myUserId.substring(0, 8)})</div>
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
        <div class="video-label">
          Peer ({peerId.substring(0, 8)})
          <span class="connection-state">
            {connectionStates.get(peerId) || 'unknown'}
          </span>
        </div>
      </div>
    {/each}

    <!-- Connected Peers without video streams yet -->
    {#each connectedPeers.filter(peerId => !remoteStreams.has(peerId)) as peerId (peerId)}
      <div class="video-wrapper remote connecting">
        <div class="connecting-indicator">
          <div class="spinner"></div>
          <div>Connecting video...</div>
        </div>
        <div class="video-label">
          Peer ({peerId.substring(0, 8)})
          <span class="connection-state">
            {connectionStates.get(peerId) || 'connecting'}
          </span>
        </div>
      </div>
    {/each}
  </div>

  <div class="controls">
    <button 
      class="control-btn" 
      class:active={isAudioEnabled}
      on:click={toggleAudio}
      disabled={!localStream}
    >
      {isAudioEnabled ? '🎤' : '🔇'}
    </button>
    
    <button 
      class="control-btn" 
      class:active={isVideoEnabled}
      on:click={toggleVideo}
      disabled={!localStream}
    >
      {isVideoEnabled ? '📹' : '📵'}
    </button>
    
    <button class="control-btn leave" on:click={leaveRoom}>
      ❌ Leave
    </button>
    
    <button class="control-btn debug" on:click={() => showDebug = !showDebug}>
      🐛 Debug
    </button>
    
    <button class="control-btn test" on:click={forceOffers}>
      🚀 Force Offers
    </button>
    
    <button class="control-btn test" on:click={debugSignaling}>
      🔍 Debug Signals
    </button>
    
    <button class="control-btn test" on:click={debugGun}>
      🔍 Debug Gun
    </button>
    
    <button class="control-btn test" on:click={testDirectOffer}>
      📨 Test Offer
    </button>
  </div>

  {#if showDebug}
    <div class="debug-panel">
      <h3>Debug Info</h3>
      <div class="debug-info">
        <p><strong>User ID:</strong> {myUserId}</p>
        <p><strong>Room:</strong> {roomId}</p>
        <p><strong>Peer Connections:</strong> {peerConnections.size}</p>
        <p><strong>Remote Streams:</strong> {remoteStreams.size}</p>
        <p><strong>Connected Peers:</strong> {connectedPeers.join(', ')}</p>
        <p><strong>Connection States:</strong></p>
        {#each Array.from(connectionStates.entries()) as [peerId, state]}
          <p class="connection-detail">
            {peerId.substring(0, 8)}: {state}
            {#if peerConnections.has(peerId)}
              (signaling: {peerConnections.get(peerId)?.signalingState})
            {/if}
          </p>
        {/each}
        <p><strong>Pending Candidates:</strong></p>
        {#each Array.from(pendingCandidates.entries()) as [peerId, candidates]}
          <p class="connection-detail">
            {peerId.substring(0, 8)}: {candidates.length} queued
          </p>
        {/each}
      </div>
      <div class="debug-logs">
        <h4>Recent Logs:</h4>
        <div class="log-container">
          {#each debugLogs as log}
            <div class="log-entry">{log}</div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .video-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #000;
    color: white;
  }

  .header {
    padding: 1rem;
    background: rgba(0,0,0,0.8);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #333;
  }

  .header h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .status {
    color: #4ade80;
    font-size: 0.9rem;
  }

  .peer-count {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .videos {
    flex: 1;
    padding: 1rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
    align-content: start;
  }

  /* Responsive grid adjustments */
  @media (max-width: 768px) {
    .videos {
      grid-template-columns: 1fr;
    }
  }

  @media (min-width: 769px) and (max-width: 1200px) {
    .videos {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1201px) {
    .videos {
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }
  }

  .video-wrapper {
    position: relative;
    background: #333;
    border-radius: 8px;
    overflow: hidden;
    aspect-ratio: 16/9;
    min-height: 200px;
  }

  .video-wrapper video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-wrapper.local video {
    transform: scaleX(-1);
  }

  .video-wrapper.local video.video-off {
    display: none;
  }

  .video-label {
    position: absolute;
    bottom: 8px;
    left: 8px;
    background: rgba(0,0,0,0.7);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
  }

  .connection-state {
    display: block;
    font-size: 0.7rem;
    color: #94a3b8;
  }

  .video-off-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 3rem;
    opacity: 0.7;
  }

  .connecting-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: #94a3b8;
  }

  .video-wrapper.connecting {
    background: #1f2937;
    border: 2px dashed #374151;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #374151;
    border-top: 3px solid #8b5cf6;
    border-radius: 50%;
    margin: 0 auto 1rem;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .controls {
    display: flex;
    justify-content: center;
    gap: 1rem;
    padding: 1rem;
    background: rgba(0,0,0,0.8);
  }

  .control-btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    background: #374151;
    color: white;
    cursor: pointer;
    font-size: 1rem;
    transition: background 0.2s;
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-btn:hover:not(:disabled) {
    background: #4b5563;
  }

  .control-btn.active {
    background: #059669;
  }

  .control-btn.leave {
    background: #dc2626;
  }

  .control-btn.leave:hover {
    background: #b91c1c;
  }

  .control-btn.debug {
    background: #8b5cf6;
  }

  .control-btn.debug:hover {
    background: #7c3aed;
  }

  .debug-panel {
    position: absolute;
    top: 60px;
    right: 10px;
    width: 350px;
    background: rgba(0,0,0,0.95);
    border: 1px solid #333;
    border-radius: 8px;
    padding: 1rem;
    font-size: 0.8rem;
    max-height: 500px;
    overflow-y: auto;
    z-index: 1000;
  }

  .debug-panel h3, .debug-panel h4 {
    margin: 0 0 0.5rem 0;
    color: #8b5cf6;
  }

  .debug-info p {
    margin: 0.25rem 0;
    word-break: break-all;
  }

  .connection-detail {
    font-family: monospace;
    font-size: 0.7rem;
    color: #94a3b8;
    margin-left: 1rem;
  }

  .debug-logs {
    margin-top: 1rem;
  }

  .log-container {
    max-height: 200px;
    overflow-y: auto;
  }

  .log-entry {
    font-family: monospace;
    font-size: 0.7rem;
    padding: 0.25rem;
    border-bottom: 1px solid #333;
    color: #94a3b8;
  }

  @media (max-width: 768px) {
    .header {
      flex-direction: column;
      gap: 0.5rem;
      align-items: flex-start;
    }

    .controls {
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .control-btn {
      flex: 1;
      min-width: 100px;
    }

    .debug-panel {
      width: calc(100vw - 20px);
      right: 10px;
      left: 10px;
    }
  }
</style>