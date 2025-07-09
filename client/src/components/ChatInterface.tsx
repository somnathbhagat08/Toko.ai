import React, { useState, useRef, useEffect } from 'react';
import { Send, SkipForward, X, Users, Video, VideoOff, Mic, MicOff, User, Star, Circle, Square, Triangle, Palette, Sparkles, ArrowLeft, Globe, Play, Square as StopIcon } from 'lucide-react';
import { Message, Stranger, ConnectionStatus, ChatMode } from '../types';
import { socketService } from '../services/socketService';
import { webrtcService } from '../services/webrtcService';
import MessageOverlay from './MessageOverlay';

interface ChatInterfaceProps {
  onDisconnect: () => void;
  chatMode: ChatMode;
  user: any;
  roomId?: string;
  stranger?: Stranger;
  isConnecting?: boolean;
}

const VIRTUAL_BACKGROUNDS = [
  { name: 'None', value: 'none' },
  { name: 'Office', value: 'office' },
  { name: 'Beach', value: 'beach' },
  { name: 'Space', value: 'space' },
  { name: 'Forest', value: 'forest' },
  { name: 'City', value: 'city' },
];

export default function ChatInterface({ onDisconnect, chatMode, user, roomId, stranger, isConnecting = false }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(isConnecting ? 'connecting' : 'connected');
  const [currentStranger, setCurrentStranger] = useState<Stranger | null>(stranger || null);
  const [isStrangerTyping, setIsStrangerTyping] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [beautyFilterEnabled, setBeautyFilterEnabled] = useState(false);
  const [selectedBackground, setSelectedBackground] = useState('none');
  const [showBackgroundOptions, setShowBackgroundOptions] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState(roomId || '');
  const [isWaitingForMatch, setIsWaitingForMatch] = useState(isConnecting);
  const [overlayMessages, setOverlayMessages] = useState<{id: string, message: string, sender: 'user' | 'stranger'}[]>([]);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [isVideoHovered, setIsVideoHovered] = useState(false);
  const [isMatchingActive, setIsMatchingActive] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState<NodeJS.Timeout | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const videoInputTimeoutRef = useRef<NodeJS.Timeout>();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Video input visibility logic
  const showVideoInputWithTimeout = () => {
    setShowVideoInput(true);

    // Clear existing timeout
    if (videoInputTimeoutRef.current) {
      clearTimeout(videoInputTimeoutRef.current);
    }

    // Set new timeout to hide after 3 seconds
    videoInputTimeoutRef.current = setTimeout(() => {
      if (!isVideoHovered) {
        setShowVideoInput(false);
      }
    }, 3000);
  };

  const handleVideoMouseEnter = () => {
    setIsVideoHovered(true);
    showVideoInputWithTimeout();
  };

  const handleVideoMouseLeave = () => {
    setIsVideoHovered(false);
    // Input will hide after timeout if not typing
  };

  const handleVideoInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    showVideoInputWithTimeout(); // Reset timeout on typing
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (videoInputTimeoutRef.current) {
        clearTimeout(videoInputTimeoutRef.current);
      }
    };
  }, []);

  const initializeLocalCamera = async () => {
    try {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('getUserMedia not supported');
        setIsVideoEnabled(false);
        setIsAudioEnabled(false);
        return;
      }

      // Get user media for local preview (during matching)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: 'user'
        }, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Update video/audio enabled states based on tracks
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      setIsVideoEnabled(videoTracks.length > 0 && videoTracks[0].enabled);
      setIsAudioEnabled(audioTracks.length > 0 && audioTracks[0].enabled);
      
      console.log('Local camera initialized successfully');
    } catch (error) {
      console.error('Error initializing local camera:', error);
      // Fallback to audio only if video fails
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ 
          video: false, 
          audio: true 
        });
        setLocalStream(audioStream);
        setIsVideoEnabled(false);
        setIsAudioEnabled(true);
        console.log('Audio-only mode enabled');
      } catch (audioError) {
        console.error('Error accessing audio:', audioError);
        setIsVideoEnabled(false);
        setIsAudioEnabled(false);
      }
    }
  };

  useEffect(() => {
    if (!socketService.isSocketConnected()) {
      setConnectionStatus('connecting');
      return;
    }

    // Set up socket event listeners
    socketService.onReceiveMessage((data) => {
      const message: Message = {
        id: Date.now().toString(),
        text: data.message,
        sender: 'stranger',
        timestamp: new Date(data.timestamp)
      };
      setMessages(prev => [...prev, message]);

      // For video mode, add overlay message
      if (chatMode === 'video') {
        const overlayId = `overlay-${Date.now()}`;
        setOverlayMessages(prev => [...prev, {
          id: overlayId,
          message: data.message,
          sender: 'stranger'
        }]);
      }
    });

    socketService.onUserTyping((isTyping) => {
      setIsStrangerTyping(isTyping);
    });

    socketService.onStrangerDisconnected(() => {
      setConnectionStatus('stranger_disconnected');
      setIsWaitingForMatch(false);
      if (chatMode === 'video') {
        // Keep local stream active but cleanup remote connection
        webrtcService.cleanup();
        setRemoteStream(null);
      }
    });

    socketService.onFindingNewMatch(() => {
      setConnectionStatus('connecting');
      setIsWaitingForMatch(true);
      setMessages([]);
      setCurrentStranger(null);
      if (chatMode === 'video') {
        // Keep local stream active but cleanup remote connection
        webrtcService.cleanup();
        setRemoteStream(null);
      }
    });

    socketService.onMatchFound((data) => {
      console.log('Match found:', data);
      setCurrentRoomId(data.roomId);
      setCurrentStranger(data.stranger);
      setConnectionStatus('connected');
      setIsWaitingForMatch(false);

      if (chatMode === 'video') {
        // Reinitialize video call for new match
        setTimeout(() => {
          initializeVideoCall();
        }, 500);
      }
    });

    // Initialize local camera immediately for video mode (even during matching)
    if (chatMode === 'video' && !localStream) {
      initializeLocalCamera();
    }

    // Initialize full video call if we have a room and not waiting
    if (chatMode === 'video' && currentRoomId && !isWaitingForMatch) {
      initializeVideoCall();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [chatMode, currentRoomId, isWaitingForMatch, localStream]);

  const initializeVideoCall = async () => {
    try {
      // Use existing local stream or get new one
      let stream = localStream;
      if (!stream) {
        stream = await webrtcService.getUserMedia({ 
          video: { width: 640, height: 480 }, 
          audio: true 
        });

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      }

      // Initialize WebRTC - determine who should be initiator based on socket ID
      const socketId = socketService.getSocketId();
      const isInitiator = Boolean(socketId && currentStranger && socketId > currentStranger.id);
      console.log('WebRTC Init:', { socketId, strangerId: currentStranger?.id, isInitiator });
      await webrtcService.initialize(currentRoomId, isInitiator);

      // Set up WebRTC event handlers
      webrtcService.onRemoteStreamReceived = (stream: MediaStream) => {
        console.log('Remote stream received');
        setRemoteStream(stream);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      };

      webrtcService.onConnectionStateChange = (state: string) => {
        console.log('WebRTC connection state:', state);
      };

      // Start the call
      await webrtcService.startCall(stream);
    } catch (error) {
      console.error('Error initializing video call:', error);
    }
  };

  const applyBeautyFilter = () => {
    if (!localVideoRef.current || !canvasRef.current || !localStream) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const video = localVideoRef.current;

    // Check if video is ready and has dimensions
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      // Video not ready, try again in next frame
      animationFrameRef.current = requestAnimationFrame(applyBeautyFilter);
      return;
    }

    // Set canvas dimensions only if they changed
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    try {
      // Clear and draw the video frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (beautyFilterEnabled) {
        // Apply CSS-based beauty filter for better performance
        canvas.style.filter = 'brightness(1.1) contrast(1.05) saturate(1.1) blur(0.3px)';
      } else {
        canvas.style.filter = 'none';
      }

      // Apply background
      if (selectedBackground !== 'none') {
        applyVirtualBackground(ctx, canvas.width, canvas.height);
      }
    } catch (error) {
      console.warn('Error applying beauty filter:', error);
      // Fallback: stop the filter to prevent further errors
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    // Schedule next frame with throttling for performance
    if (beautyFilterEnabled || selectedBackground !== 'none') {
      animationFrameRef.current = requestAnimationFrame(() => {
        setTimeout(applyBeautyFilter, 100); // Reduced to 10 FPS for better performance
      });
    }
  };

  const applyVirtualBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Enhanced background replacement
    const gradient = ctx.createLinearGradient(0, 0, width, height);

    switch (selectedBackground) {
      case 'office':
        gradient.addColorStop(0, '#f8f9fa');
        gradient.addColorStop(0.5, '#e9ecef');
        gradient.addColorStop(1, '#dee2e6');
        break;
      case 'beach':
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(0.7, '#F0E68C');
        gradient.addColorStop(1, '#DEB887');
        break;
      case 'space':
        gradient.addColorStop(0, '#000011');
        gradient.addColorStop(0.5, '#000033');
        gradient.addColorStop(1, '#000055');
        break;
      case 'forest':
        gradient.addColorStop(0, '#228B22');
        gradient.addColorStop(0.5, '#32CD32');
        gradient.addColorStop(1, '#006400');
        break;
      case 'city':
        gradient.addColorStop(0, '#696969');
        gradient.addColorStop(0.5, '#808080');
        gradient.addColorStop(1, '#2F4F4F');
        break;
    }

    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  };

  useEffect(() => {
    if (chatMode === 'video' && localStream && (beautyFilterEnabled || selectedBackground !== 'none')) {
      // Clear any existing animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      applyBeautyFilter();
    } else {
      // Stop beauty filter processing if disabled
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [beautyFilterEnabled, selectedBackground, localStream, chatMode]);

  const toggleVideo = async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);

        // Update WebRTC if connected
        if (webrtcService.getLocalStream()) {
          const webrtcVideoTrack = webrtcService.getLocalStream()?.getVideoTracks()[0];
          if (webrtcVideoTrack) {
            webrtcVideoTrack.enabled = videoTrack.enabled;
          }
        }
      } else if (!isVideoEnabled) {
        // Add video track to existing stream
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          localStream.addTrack(newVideoTrack);
          setIsVideoEnabled(true);

          // Update video display
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
          }
        } catch (error) {
          console.error('Error adding video:', error);
        }
      }
    }
  };

  const toggleAudio = async () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);

        // Update WebRTC if connected
        if (webrtcService.getLocalStream()) {
          const webrtcAudioTrack = webrtcService.getLocalStream()?.getAudioTracks()[0];
          if (webrtcAudioTrack) {
            webrtcAudioTrack.enabled = audioTrack.enabled;
          }
        }
      } else if (!isAudioEnabled) {
        // Add audio track to existing stream
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const newAudioTrack = audioStream.getAudioTracks()[0];
          localStream.addTrack(newAudioTrack);
          setIsAudioEnabled(true);
        } catch (error) {
          console.error('Error adding audio:', error);
        }
      }
    }
  };

  const sendMessage = () => {
    if (!inputValue.trim() || connectionStatus !== 'connected' || !currentRoomId) return;

    const message: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, message]);
    socketService.sendMessage(currentRoomId, inputValue);

    // For video mode, add overlay message
    if (chatMode === 'video') {
      const overlayId = `overlay-${Date.now()}`;
      setOverlayMessages(prev => [...prev, {
        id: overlayId,
        message: inputValue,
        sender: 'user'
      }]);
    }

    setInputValue('');

    // Stop typing indicator
    socketService.stopTyping(currentRoomId);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  const skipChat = () => {
    if (currentRoomId) {
      // Disconnect from current chat
      socketService.skipChat(currentRoomId);
      setConnectionStatus('disconnected');
      setMessages([]);
      setCurrentStranger(null);
      setOverlayMessages([]);

      if (chatMode === 'video') {
        webrtcService.cleanup();
        setRemoteStream(null);
      }

      // Start looking for a new match immediately
      setTimeout(() => {
        setIsWaitingForMatch(true);
        setConnectionStatus('connecting');
        // Rejoin the queue with the same preferences
        socketService.joinQueue({
          user: user,
          interests: [],
          chatMode: chatMode,
          genderPreference: 'any',
          countryPreference: 'Any on Earth'
        });
      }, 500);
    }
  };

  const startMatching = () => {
    setIsMatchingActive(true);
    setIsWaitingForMatch(true);
    setConnectionStatus('connecting');
    setMessages([]);
    setCurrentStranger(null);

    if (chatMode === 'video') {
      webrtcService.cleanup();
      setRemoteStream(null);
    }
  };

  const stopMatching = () => {
    setIsMatchingActive(false);
    setIsWaitingForMatch(false);
    setConnectionStatus('disconnected');
    setMessages([]);
    setCurrentStranger(null);

    if (currentRoomId) {
      socketService.skipChat(currentRoomId);
    }

    if (chatMode === 'video') {
      webrtcService.cleanup();
      setRemoteStream(null);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);

    if (currentRoomId) {
      if (e.target.value.length > 0) {
        socketService.startTyping(currentRoomId);

        // Clear existing timeout
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }

        // Set new timeout to stop typing
        typingTimeoutRef.current = setTimeout(() => {
          socketService.stopTyping(currentRoomId);
        }, 1000);
      } else {
        socketService.stopTyping(currentRoomId);
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
      }
    }
  };

  const handleDisconnect = () => {
    if (currentRoomId) {
      socketService.leaveChat(currentRoomId);
    }

    if (chatMode === 'video') {
      webrtcService.cleanup();
    }

    onDisconnect();
  };

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 relative overflow-hidden">
      {/* Dotted Grid Background */}
      <div 
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage: `
            radial-gradient(circle, #000 1.5px, transparent 1.5px),
            linear-gradient(to right, #000 0.8px, transparent 0.8px),
            linear-gradient(to bottom, #000 0.8px, transparent 0.8px)
          `,
          backgroundSize: '25px 25px, 50px 50px, 50px 50px'
        }}
      />

      {/* Enhanced Geometric Shapes Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Stars */}
        {[...Array(12)].map((_, i) => (
          <div
            key={`star-${i}`}
            className="absolute opacity-[0.08]"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
              fontSize: `${Math.random() * 40 + 30}px`
            }}
          >
            <Star className="fill-current text-green-500" />
          </div>
        ))}

        {/* Circles */}
        {[...Array(10)].map((_, i) => (
          <div
            key={`circle-${i}`}
            className="absolute opacity-[0.08]"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              fontSize: `${Math.random() * 45 + 25}px`
            }}
          >
            <Circle className="fill-current text-cyan-400" />
          </div>
        ))}

        {/* Squares */}
        {[...Array(8)].map((_, i) => (
          <div
            key={`square-${i}`}
            className="absolute opacity-[0.08]"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 45}deg)`,
              fontSize: `${Math.random() * 35 + 20}px`
            }}
          >
            <Square className="fill-current text-purple-500" />
          </div>
        ))}

        {/* Triangles */}
        {[...Array(6)].map((_, i) => (
          <div
            key={`triangle-${i}`}
            className="absolute opacity-[0.08]"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
              fontSize: `${Math.random() * 30 + 15}px`
            }}
          >
            <Triangle className="fill-current text-orange-500" />
          </div>
        ))}

        {/* People Icons */}
        {[...Array(15)].map((_, i) => (
          <div
            key={`user-${i}`}
            className="absolute opacity-[0.06] text-black"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
              fontSize: `${Math.random() * 40 + 20}px`
            }}
          >
            <User />
          </div>
        ))}
      </div>

      <div className="relative z-10 h-full flex flex-col p-1 sm:p-3">
        {/* Header */}
        <div className="bg-white border-4 border-black p-2 sm:p-3 shadow-[6px_6px_0px_0px_#000] mb-1 sm:mb-3">
          {/* Mobile Layout - Single Row */}
          <div className="sm:hidden">
            <div className="flex items-center justify-between">
              {/* Left side - Back, Logo, Status */}
              <div className="flex items-center gap-1">
                <button
                  onClick={onDisconnect}
                  className="bg-gray-100 border-2 border-black p-1 shadow-[2px_2px_0px_0px_#000] hover:bg-gray-200 transition-all"
                  title="Go back to home"
                >
                  <ArrowLeft className="w-3 h-3 text-black" />
                </button>
                <div>
                  <h1 className="text-sm font-black text-black flex items-center gap-1">
                    TOKO
                    <span className="text-xs bg-black text-white px-1 py-0.5">
                      {chatMode.toUpperCase()}
                    </span>
                    {chatMode === 'video' && (
                      <div className="animate-spin relative">
                        <div className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-400 via-green-400 to-blue-600 border border-gray-300 relative overflow-hidden shadow-inner">
                          <div className="absolute top-0.5 left-0.5 w-0.5 h-0.5 bg-green-600 rounded-full opacity-80"></div>
                          <div className="absolute top-1 right-0.5 w-0.5 h-1 bg-green-700 rounded opacity-70"></div>
                          <div className="absolute bottom-0.5 left-0.5 w-1 h-0.5 bg-green-600 rounded opacity-75"></div>
                          <div className="absolute bottom-1 right-0.5 w-0.5 h-0.5 bg-green-700 rounded-full opacity-65"></div>
                          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-blue-200/20 to-transparent"></div>
                          <div className="absolute top-0 left-0 w-1.5 h-1.5 bg-gradient-to-br from-white/40 to-transparent rounded-full"></div>
                        </div>
                      </div>
                    )}
                  </h1>
                  <div className="flex items-center gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full border border-black ${
                      connectionStatus === 'connected' ? 'bg-black' : 
                      connectionStatus === 'connecting' ? 'bg-gray-400' : 'bg-gray-300'
                    }`} />
                    <span className="font-black text-xs text-gray-700">
                      {connectionStatus === 'connected' ? 'CONNECTED' :
                       connectionStatus === 'connecting' ? 'CONNECTING...' : 
                       connectionStatus === 'stranger_disconnected' ? 'STRANGER LEFT' : 'DISCONNECTED'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right side - Controls and Close */}
              <div className="flex items-center gap-1">
                {!isMatchingActive ? (
                  <button
                    onClick={startMatching}
                    className="bg-green-400 hover:bg-green-500 text-black border-2 border-black px-2 py-1 font-black transition-all shadow-[2px_2px_0px_0px_#000] hover:shadow-[3px_3px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation"
                  >
                    <div className="flex items-center gap-1">
                      <Play className="w-3 h-3" />
                      <span className="text-xs">START</span>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={stopMatching}
                    className="bg-red-400 hover:bg-red-500 text-black border-2 border-black px-2 py-1 font-black transition-all shadow-[2px_2px_0px_0px_#000] hover:shadow-[3px_3px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation"
                  >
                    <div className="flex items-center gap-1">
                      <StopIcon className="w-3 h-3" />
                      <span className="text-xs">STOP</span>
                    </div>
                  </button>
                )}

                <button
                  onClick={skipChat}
                  disabled={connectionStatus !== 'connected' && !isWaitingForMatch}
                  className="border-2 border-black px-2 py-1 font-black transition-all shadow-[2px_2px_0px_0px_#000] hover:shadow-[3px_3px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                  style={{ backgroundColor: '#FF00F5', color: 'black' }}
                >
                  <div className="flex items-center gap-1">
                    <SkipForward className="w-3 h-3" />
                    <span className="text-xs">NEXT</span>
                  </div>
                </button>

                <button
                  onClick={handleDisconnect}
                  className="bg-red-500 hover:bg-red-600 text-white border-2 border-black px-2 py-1 font-black transition-all shadow-[2px_2px_0px_0px_#666] hover:shadow-[3px_3px_0px_0px_#FF4911] hover:translate-x-[-1px] hover:translate-y-[-1px]"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Layout - Single Row */}
          <div className="hidden sm:flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Back Button */}
              <button
                onClick={onDisconnect}
                className="bg-gray-100 border-3 border-black p-2 shadow-[2px_2px_0px_0px_#000] hover:bg-gray-200 hover:shadow-[3px_3px_0px_0px_#666] transition-all"
                title="Go back to home"
              >
                <ArrowLeft className="w-5 h-5 text-black" />
              </button>

              <div className="bg-gray-100 border-3 border-black p-2 shadow-[2px_2px_0px_0px_#000]">
                {chatMode === 'video' ? (
                  <Video className="w-5 h-5 text-black" />
                ) : (
                  <Users className="w-5 h-5 text-black" />
                )}
              </div>
              <div>
                <h1 className="text-2xl font-black text-black flex items-center gap-2">
                  TOKO
                  <span className="text-xs bg-black text-white px-2 py-1">
                    {chatMode.toUpperCase()}
                  </span>
                  {/* 3D Realistic Globe for Video Mode */}
                  {chatMode === 'video' && (
                    <div className="animate-spin relative">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 via-green-400 to-blue-600 border border-gray-300 relative overflow-hidden shadow-inner">
                        {/* Continental shapes */}
                        <div className="absolute top-1 left-1 w-1 h-1 bg-green-600 rounded-full opacity-80"></div>
                        <div className="absolute top-2 right-1 w-0.5 h-1.5 bg-green-700 rounded opacity-70"></div>
                        <div className="absolute bottom-1 left-0.5 w-1.5 h-0.5 bg-green-600 rounded opacity-75"></div>
                        <div className="absolute bottom-2 right-0.5 w-1 h-1 bg-green-700 rounded-full opacity-65"></div>
                        {/* Ocean depth effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-blue-200/20 to-transparent"></div>
                        {/* Highlight/shine effect */}
                        <div className="absolute top-0 left-0 w-2 h-2 bg-gradient-to-br from-white/40 to-transparent rounded-full"></div>
                      </div>
                    </div>
                  )}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-2 h-2 rounded-full border-2 border-black ${
                    connectionStatus === 'connected' ? 'bg-black' : 
                    connectionStatus === 'connecting' ? 'bg-gray-400' : 'bg-gray-300'
                  }`} />
                  <span className="font-black text-xs text-gray-700">
                    {connectionStatus === 'connected' ? 'CONNECTED' :
                     connectionStatus === 'connecting' ? 'CONNECTING...' : 
                     connectionStatus === 'stranger_disconnected' ? 'STRANGER LEFT' : 'DISCONNECTED'}
                  </span>
                </div>
              </div>
            </div>

            {/* START/STOP and NEXT Controls - Centered */}
            <div className="absolute left-1/2 transform -translate-x-1/2 flex gap-2">
              {!isMatchingActive ? (
                <button
                  onClick={startMatching}
                  className="bg-green-400 hover:bg-green-500 text-black border-4 border-black px-4 py-2 font-black transition-all shadow-[4px_4px_0px_0px_#000] hover:shadow-[6px_6px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation"
                >
                  <div className="flex items-center gap-2">
                    <Play className="w-4 h-4" />
                    <span className="text-sm">START</span>
                  </div>
                </button>
              ) : (
                <button
                  onClick={stopMatching}
                  className="bg-red-400 hover:bg-red-500 text-black border-4 border-black px-4 py-2 font-black transition-all shadow-[4px_4px_0px_0px_#000] hover:shadow-[6px_6px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation"
                >
                  <div className="flex items-center gap-2">
                    <StopIcon className="w-4 h-4" />
                    <span className="text-sm">STOP</span>
                  </div>
                </button>
              )}

              {/* NEXT Button with Neubrutalism Color */}
              <button
                onClick={skipChat}
                disabled={connectionStatus !== 'connected' && !isWaitingForMatch}
                className="border-4 border-black px-4 py-2 font-black transition-all shadow-[4px_4px_0px_0px_#000] hover:shadow-[6px_6px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                style={{ backgroundColor: '#FF00F5', color: 'black' }}
              >
                <div className="flex items-center gap-2">
                  <SkipForward className="w-4 h-4" />
                  <span className="text-sm">NEXT</span>
                </div>
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleDisconnect}
                className="bg-red-500 hover:bg-red-600 text-white border-3 border-black px-4 py-3 font-black transition-all shadow-[3px_3px_0px_0px_#666] hover:shadow-[4px_4px_0px_0px_#FF4911] hover:translate-x-[-1px] hover:translate-y-[-1px] active:bg-red-700 active:shadow-[3px_3px_0px_0px_#8A2BE2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-h-0">
          {chatMode === 'video' ? (
            // Video Mode - Full Width Half-and-Half Layout
            <div 
              className="h-full bg-white border-4 border-black shadow-[6px_6px_0px_0px_#000] overflow-hidden relative"
              onMouseEnter={handleVideoMouseEnter}
              onMouseLeave={handleVideoMouseLeave}
            >
              <div className="h-full flex flex-col sm:flex-row gap-1 px-1 sm:p-0">
                {/* Local Video - Top Half on Mobile, Left Half on Desktop */}
                <div 
                  className="w-full h-1/2 sm:w-1/2 sm:h-full relative bg-gray-900"
                  onMouseEnter={() => {
                    if (hoverTimeout) clearTimeout(hoverTimeout);
                    setIsVideoHovered(true);
                  }}
                  onMouseLeave={() => {
                    const timeout = setTimeout(() => {
                      setIsVideoHovered(false);
                    }, 3000);
                    setHoverTimeout(timeout);
                  }}
                  onTouchStart={() => {
                    setIsVideoHovered(true);
                    showVideoInputWithTimeout();
                  }}
                >
                  <div className="absolute top-4 left-4 bg-black text-white px-3 py-1 font-black text-sm z-20 shadow-[2px_2px_0px_0px_#666]">
                    YOU
                  </div>

                  {/* Video Controls - Show on Hover/Touch for 3 seconds */}
                  <div className={`absolute top-2 right-2 sm:top-4 sm:right-4 flex gap-1 sm:gap-2 z-20 transition-all duration-300 ${
                    isVideoHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}>
                    {/* Beauty Filter Button */}
                    <button
                      onClick={() => setBeautyFilterEnabled(!beautyFilterEnabled)}
                      className={`border-2 sm:border-3 border-black px-2 sm:px-3 py-2 sm:py-3 font-black transition-all shadow-[2px_2px_0px_0px_#666] sm:shadow-[3px_3px_0px_0px_#666] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation ${
                        beautyFilterEnabled 
                          ? 'bg-black text-white hover:bg-green-400 hover:shadow-[3px_3px_0px_0px_#00FF88] sm:hover:shadow-[4px_4px_0px_0px_#00FF88] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2]' 
                          : 'bg-gray-300 text-black hover:bg-green-400 hover:shadow-[3px_3px_0px_0px_#00FF88] sm:hover:shadow-[4px_4px_0px_0px_#00FF88] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2]'
                      }`}
                    >
                      <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>

                    {/* Background Change Button */}
                    <div className="relative">
                      <button
                        onClick={() => setShowBackgroundOptions(!showBackgroundOptions)}
                        className="bg-black text-white border-2 sm:border-3 border-black px-2 sm:px-3 py-2 sm:py-3 font-black transition-all shadow-[2px_2px_0px_0px_#666] sm:shadow-[3px_3px_0px_0px_#666] hover:bg-green-400 hover:shadow-[3px_3px_0px_0px_#00FF88] sm:hover:shadow-[4px_4px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2] touch-manipulation"
                      >
                        <Palette className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                      {showBackgroundOptions && (
                        <div className="absolute top-full right-0 mt-1 sm:mt-2 bg-white border-2 sm:border-3 border-black shadow-[3px_3px_0px_0px_#000] sm:shadow-[4px_4px_0px_0px_#000] p-1 sm:p-2 z-50 min-w-[120px]">
                          {VIRTUAL_BACKGROUNDS.map(bg => (
                            <button
                              key={bg.value}
                              onClick={() => {
                                setSelectedBackground(bg.value);
                                setShowBackgroundOptions(false);
                              }}
                              className={`block w-full text-left px-2 py-1.5 sm:py-1 font-bold hover:bg-green-400 hover:text-black transition-colors text-xs touch-manipulation ${
                                selectedBackground === bg.value ? 'bg-black text-white' : 'text-black'
                              }`}
                            >
                              {bg.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Camera Button */}
                    <button
                      onClick={toggleVideo}
                      className={`border-2 sm:border-3 border-black px-2 sm:px-3 py-2 sm:py-3 font-black transition-all shadow-[2px_2px_0px_0px_#666] sm:shadow-[3px_3px_0px_0px_#666] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation ${
                        isVideoEnabled 
                          ? 'bg-black text-white hover:bg-green-400 hover:shadow-[3px_3px_0px_0px_#00FF88] sm:hover:shadow-[4px_4px_0px_0px_#00FF88] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2]' 
                          : 'bg-gray-300 text-black hover:bg-red-400 hover:shadow-[3px_3px_0px_0px_#FF4911] sm:hover:shadow-[4px_4px_0px_0px_#FF4911] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2]'
                      }`}
                    >
                      {isVideoEnabled ? <Video className="w-4 h-4 sm:w-5 sm:h-5" /> : <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </button>

                    {/* Microphone Button */}
                    <button
                      onClick={toggleAudio}
                      className={`border-2 sm:border-3 border-black px-2 sm:px-3 py-2 sm:py-3 font-black transition-all shadow-[2px_2px_0px_0px_#666] sm:shadow-[3px_3px_0px_0px_#666] hover:translate-x-[-1px] hover:translate-y-[-1px] touch-manipulation ${
                        isAudioEnabled 
                          ? 'bg-black text-white hover:bg-green-400 hover:shadow-[3px_3px_0px_0px_#00FF88] sm:hover:shadow-[4px_4px_0px_0px_#00FF88] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2]' 
                          : 'bg-gray-300 text-black hover:bg-red-400 hover:shadow-[3px_3px_0px_0px_#FF4911] sm:hover:shadow-[4px_4px_0px_0px_#FF4911] active:bg-purple-500 active:shadow-[2px_2px_0px_0px_#8A2BE2] sm:active:shadow-[3px_3px_0px_0px_#8A2BE2]'
                      }`}
                    >
                      {isAudioEnabled ? <Mic className="w-4 h-4 sm:w-5 sm:h-5" /> : <MicOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </button>
                  </div>

                  <div className="w-full h-full relative">
                    {localStream ? (
                      <>
                        <video
                          ref={localVideoRef}
                          autoPlay
                          muted
                          className="w-full h-full object-cover"
                          style={{ display: beautyFilterEnabled || selectedBackground !== 'none' ? 'none' : 'block' }}
                        />
                        <canvas
                          ref={canvasRef}
                          className="w-full h-full object-cover"
                          style={{ display: beautyFilterEnabled || selectedBackground !== 'none' ? 'block' : 'none' }}
                        />
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-white font-black text-center">
                          <User className="w-12 h-12 mx-auto mb-3" />
                          <p className="text-sm">LOADING CAMERA...</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* User Message Overlays */}
                  {overlayMessages
                    .filter(msg => msg.sender === 'user')
                    .map(msg => (
                      <MessageOverlay
                        key={msg.id}
                        message={msg.message}
                        sender={msg.sender}
                        onComplete={() => setOverlayMessages(prev => prev.filter(m => m.id !== msg.id))}
                      />
                    ))
                  }
                </div>

                {/* Remote Video - Bottom Half on Mobile, Right Half on Desktop */}
                <div className="w-full h-1/2 sm:w-1/2 sm:h-full relative bg-gray-900">
                  <div className="absolute top-2 left-2 bg-black text-white px-2 py-1 font-black text-xs z-20 shadow-[2px_2px_0px_0px_#666]">
                    {isWaitingForMatch ? 'FINDING...' : 'STRANGER'}
                  </div>
                  <div className="w-full h-full relative">
                    {remoteStream && !isWaitingForMatch ? (
                      <video
                        ref={remoteVideoRef}
                        autoPlay
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-white font-black text-center">
                          {isWaitingForMatch ? (
                            <>
                              <div className="animate-spin w-12 h-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
                              <p className="text-lg mb-2">FINDING MATCH...</p>
                              <p className="text-sm opacity-70">Looking for someone awesome!</p>
                            </>
                          ) : connectionStatus === 'connecting' ? (
                            <>
                              <User className="w-12 h-12 mx-auto mb-3 animate-pulse" />
                              <p className="text-sm">CONNECTING...</p>
                            </>
                          ) : (
                            <>
                              <User className="w-12 h-12 mx-auto mb-3" />
                              <p className="text-sm">WAITING FOR VIDEO...</p>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stranger Message Overlays */}
                  {overlayMessages
                    .filter(msg => msg.sender === 'stranger')
                    .map(msg => (
                      <MessageOverlay
                        key={msg.id}
                        message={msg.message}
                        sender={msg.sender}
                        onComplete={() => setOverlayMessages(prev => prev.filter(m => m.id !== msg.id))}
                      />
                    ))
                  }
                </div>
              </div>



              {/* Text Input for Video Mode - Floating at Bottom with Animation */}
              <div 
                className={`absolute bottom-4 sm:bottom-16 left-1/2 transform -translate-x-1/2 w-full max-w-[calc(100%-1rem)] sm:w-96 sm:max-w-[calc(100%-2rem)] z-30 transition-all duration-300 ease-in-out px-2 sm:px-0 ${
                  showVideoInput ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
                }`}
              >
                <div className="flex gap-2 bg-white border-2 sm:border-3 border-black p-2 sm:p-3 shadow-[3px_3px_0px_0px_#000] sm:shadow-[4px_4px_0px_0px_#000]">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={handleVideoInputChange}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    onFocus={showVideoInputWithTimeout}
                    placeholder={connectionStatus === 'connected' ? 'Type your message...' : 'Connecting...'}
                    disabled={connectionStatus !== 'connected'}
                    className="flex-1 px-2 sm:px-3 py-2 border-1 sm:border-2 border-black font-bold bg-gray-50 focus:outline-none focus:bg-white focus:border-green-400 text-sm transition-all disabled:opacity-50 touch-manipulation"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!inputValue.trim() || connectionStatus !== 'connected'}
                    className="bg-black hover:bg-green-400 text-white border-1 sm:border-2 border-black px-2 sm:px-3 py-2 font-black transition-all hover:shadow-[1px_1px_0px_0px_#00FF88] sm:hover:shadow-[2px_2px_0px_0px_#00FF88] disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                  >
                    <Send className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Text Mode - Regular Chat Layout
            <div className="bg-white border-4 border-black shadow-[6px_6px_0px_0px_#000] p-3 overflow-hidden flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {(connectionStatus === 'connecting' || isWaitingForMatch) && (
                <div className="text-center py-6">
                  <div className="bg-gray-100 border-4 border-black p-4 inline-block shadow-[4px_4px_0px_0px_#000]">
                    <div className="animate-spin w-6 h-6 border-4 border-black border-t-transparent rounded-full mx-auto mb-2"></div>
                    <p className="font-black text-base text-black mb-1">
                      {isWaitingForMatch ? 'FINDING NEW MATCH...' : 'FINDING USER...'}
                    </p>
                    <p className="font-bold text-gray-600 text-xs">"Patience is the key to paradise"</p>
                  </div>
                </div>
              )}

              {connectionStatus === 'stranger_disconnected' && (
                <div className="text-center py-6">
                  <div className="bg-red-100 border-4 border-black p-4 inline-block shadow-[4px_4px_0px_0px_#000]">
                    <User className="w-6 h-6 mx-auto mb-2 text-red-600" />
                    <p className="font-black text-base text-black mb-1">STRANGER LEFT</p>
                    <p className="font-bold text-gray-600 text-xs">Click skip to find a new person</p>
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-xs px-3 py-2 border-3 border-black font-bold shadow-[3px_3px_0px_0px_#000] ${
                    message.sender === 'user'
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-black'
                  }`}>
                    <p className="font-bold leading-relaxed text-xs">{message.text}</p>
                    <p className="text-xs mt-1 opacity-70 font-black">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}

              {isStrangerTyping && (
                <div className="flex justify-start">
                  <div className="bg-gray-200 border-3 border-black px-3 py-2 font-bold shadow-[3px_3px_0px_0px_#000]">
                    <div className="flex items-center gap-2">
                      <span className="text-black font-black text-xs">TYPING</span>
                      <div className="flex gap-1">
                        <div className="w-1 h-1 bg-black rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1 h-1 bg-black rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1 h-1 bg-black rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>



            {/* Input Area */}
            <div className="mt-3 flex gap-2 flex-none shrink-0">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={connectionStatus === 'connected' ? 'Type your message...' : 'Connecting...'}
                disabled={connectionStatus !== 'connected'}
                className="flex-1 px-3 py-2 border-3 border-black font-bold bg-gray-50 shadow-[3px_3px_0px_0px_#000] disabled:opacity-50 focus:outline-none focus:bg-white focus:shadow-[4px_4px_0px_0px_#00FF88] focus:border-green-400 text-xs transition-all"
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || connectionStatus !== 'connected'}
                className="bg-black hover:bg-green-400 text-white border-3 border-black px-4 py-2 font-black transition-all shadow-[3px_3px_0px_0px_#666] hover:shadow-[4px_4px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] active:bg-purple-500 active:shadow-[3px_3px_0px_0px_#8A2BE2] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}