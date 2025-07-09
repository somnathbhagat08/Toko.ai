import { socketService } from './socketService';

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private roomId: string | null = null;
  private isInitiator = false;

  // ICE servers configuration
  private iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  };

  async initialize(roomId: string, isInitiator: boolean = false): Promise<void> {
    this.roomId = roomId;
    this.isInitiator = isInitiator;

    // Create peer connection
    this.peerConnection = new RTCPeerConnection(this.iceServers);

    // Set up event handlers
    this.setupPeerConnectionHandlers();

    // Set up socket event handlers
    this.setupSocketHandlers();
  }

  private setupPeerConnectionHandlers() {
    if (!this.peerConnection) return;

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomId) {
        socketService.sendIceCandidate(this.roomId, event.candidate);
      }
    };

    // Handle remote stream
    this.peerConnection.ontrack = (event) => {
      console.log('Received remote stream');
      this.remoteStream = event.streams[0];
      this.onRemoteStreamReceived?.(this.remoteStream);
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection?.connectionState);
      this.onConnectionStateChange?.(this.peerConnection?.connectionState || 'disconnected');
    };
  }

  private setupSocketHandlers() {
    // Handle incoming offers
    socketService.onWebRTCOffer(async (data) => {
      if (!this.peerConnection || !this.roomId) return;

      try {
        await this.peerConnection.setRemoteDescription(data.offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        socketService.sendAnswer(this.roomId, answer);
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    });

    // Handle incoming answers
    socketService.onWebRTCAnswer(async (data) => {
      if (!this.peerConnection) return;

      try {
        await this.peerConnection.setRemoteDescription(data.answer);
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    });

    // Handle incoming ICE candidates
    socketService.onWebRTCIceCandidate(async (data) => {
      if (!this.peerConnection) return;

      try {
        await this.peerConnection.addIceCandidate(data.candidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    });
  }

  async startCall(localStream: MediaStream): Promise<void> {
    if (!this.peerConnection || !this.roomId) {
      throw new Error('WebRTC not initialized');
    }

    this.localStream = localStream;

    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
      this.peerConnection?.addTrack(track, localStream);
    });

    if (this.isInitiator) {
      // Create and send offer
      try {
        const offer = await this.peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await this.peerConnection.setLocalDescription(offer);
        socketService.sendOffer(this.roomId, offer);
      } catch (error) {
        console.error('Error creating offer:', error);
        throw error;
      }
    }
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported');
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('getUserMedia successful:', stream);
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return videoTrack.enabled;
    }
    return false;
  }

  toggleAudio(): boolean {
    if (!this.localStream) return false;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return audioTrack.enabled;
    }
    return false;
  }

  cleanup() {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.roomId = null;
    this.isInitiator = false;
  }

  // Callback handlers (to be set by components)
  onRemoteStreamReceived?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: string) => void;

  // Getters
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  getConnectionState(): string {
    return this.peerConnection?.connectionState || 'disconnected';
  }
}

export const webrtcService = new WebRTCService();