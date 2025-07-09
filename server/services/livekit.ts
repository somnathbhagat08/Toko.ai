import { AccessToken } from 'livekit-server-sdk';
import { log } from '../vite.js';
import { monitoringService } from '../monitoring.js';

interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
}

interface ParticipantInfo {
  identity: string;
  name: string;
  metadata?: string;
  permissions?: {
    canPublish: boolean;
    canSubscribe: boolean;
    canPublishData: boolean;
    hidden: boolean;
  };
}

class LiveKitService {
  private config: LiveKitConfig;

  constructor() {
    this.config = {
      apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
      apiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
      wsUrl: process.env.LIVEKIT_WS_URL || 'wss://toko-livekit.livekit.cloud'
    };

    if (!process.env.LIVEKIT_API_KEY) {
      log('LiveKit running in development mode with default credentials', 'livekit');
    }
  }

  /**
   * Create a room token for a participant to join a LiveKit room
   */
  async createRoomToken(
    roomName: string, 
    participantInfo: ParticipantInfo,
    tokenDuration: number = 3600 // 1 hour default
  ): Promise<string> {
    try {
      const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
        identity: participantInfo.identity,
        name: participantInfo.name,
        metadata: participantInfo.metadata,
        ttl: tokenDuration
      });

      // Set participant permissions
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: participantInfo.permissions?.canPublish ?? true,
        canSubscribe: participantInfo.permissions?.canSubscribe ?? true,
        canPublishData: participantInfo.permissions?.canPublishData ?? true,
        hidden: participantInfo.permissions?.hidden ?? false,
        canUpdateOwnMetadata: true
      });

      const token = at.toJwt();
      
      log(`Created LiveKit token for ${participantInfo.identity} in room ${roomName}`, 'livekit');
      monitoringService.recordMetric('video.call_start', 1);
      
      return token;
    } catch (error) {
      log(`Error creating LiveKit token: ${error}`, 'livekit');
      monitoringService.trackError('livekit_token', `Failed to create token: ${error}`);
      throw error;
    }
  }

  /**
   * Create tokens for a matched pair of users
   */
  async createMatchTokens(roomId: string, user1Id: string, user2Id: string): Promise<{
    user1Token: string;
    user2Token: string;
    roomUrl: string;
  }> {
    try {
      const [user1Token, user2Token] = await Promise.all([
        this.createRoomToken(roomId, {
          identity: user1Id,
          name: `User_${user1Id}`,
          metadata: JSON.stringify({ joinedAt: Date.now() }),
          permissions: {
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
            hidden: false
          }
        }),
        this.createRoomToken(roomId, {
          identity: user2Id,
          name: `User_${user2Id}`,
          metadata: JSON.stringify({ joinedAt: Date.now() }),
          permissions: {
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
            hidden: false
          }
        })
      ]);

      const roomUrl = `${this.config.wsUrl}?token=`;

      log(`Created match tokens for room ${roomId}`, 'livekit');
      
      return {
        user1Token,
        user2Token,
        roomUrl
      };
    } catch (error) {
      log(`Error creating match tokens: ${error}`, 'livekit');
      monitoringService.trackError('livekit_match', `Failed to create match tokens: ${error}`);
      throw error;
    }
  }

  /**
   * Create a token for screen sharing
   */
  async createScreenShareToken(roomName: string, userId: string): Promise<string> {
    return this.createRoomToken(roomName, {
      identity: `${userId}_screen`,
      name: `${userId}_screen_share`,
      metadata: JSON.stringify({ type: 'screen_share', parentUser: userId }),
      permissions: {
        canPublish: true,
        canSubscribe: false,
        canPublishData: false,
        hidden: false
      }
    });
  }

  /**
   * Create a token for recording bot
   */
  async createRecordingToken(roomName: string): Promise<string> {
    return this.createRoomToken(roomName, {
      identity: `recorder_${Date.now()}`,
      name: 'Recording Bot',
      metadata: JSON.stringify({ type: 'recorder', automated: true }),
      permissions: {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
        hidden: true
      }
    }, 7200); // 2 hours for recording
  }

  /**
   * Get room connection details for frontend
   */
  getRoomConnectionInfo(token: string) {
    return {
      token,
      serverUrl: this.config.wsUrl,
      options: {
        // WebRTC configuration
        rtcConfig: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        },
        // Connection options
        connectOptions: {
          autoSubscribe: true,
          publishDefaults: {
            videoEncoding: {
              maxBitrate: 1500000, // 1.5 Mbps
              maxFramerate: 30
            },
            audioEncoding: {
              maxBitrate: 64000 // 64 kbps
            }
          }
        },
        // Room options
        roomOptions: {
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: {
              width: 1280,
              height: 720
            }
          }
        }
      }
    };
  }

  /**
   * Create webhook validation for LiveKit events
   */
  validateWebhook(body: string, signature: string): boolean {
    try {
      // In production, implement proper webhook signature validation
      // For now, return true for development
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      
      // TODO: Implement HMAC signature validation
      // const expectedSignature = crypto
      //   .createHmac('sha256', this.config.apiSecret)
      //   .update(body)
      //   .digest('hex');
      
      // return signature === expectedSignature;
      return true;
    } catch (error) {
      log(`Webhook validation error: ${error}`, 'livekit');
      return false;
    }
  }

  /**
   * Handle LiveKit webhook events
   */
  async handleWebhookEvent(eventType: string, eventData: any): Promise<void> {
    try {
      switch (eventType) {
        case 'room_started':
          log(`Room started: ${eventData.room?.name}`, 'livekit');
          monitoringService.recordMetric('livekit.rooms.started', 1);
          break;
          
        case 'room_finished':
          log(`Room finished: ${eventData.room?.name}`, 'livekit');
          monitoringService.recordMetric('livekit.rooms.finished', 1);
          
          if (eventData.room?.duration) {
            monitoringService.recordTiming('livekit.room.duration', eventData.room.duration);
          }
          break;
          
        case 'participant_joined':
          log(`Participant joined: ${eventData.participant?.identity} in ${eventData.room?.name}`, 'livekit');
          monitoringService.recordMetric('livekit.participants.joined', 1);
          break;
          
        case 'participant_left':
          log(`Participant left: ${eventData.participant?.identity} in ${eventData.room?.name}`, 'livekit');
          monitoringService.recordMetric('livekit.participants.left', 1);
          break;
          
        case 'track_published':
          log(`Track published: ${eventData.track?.type} by ${eventData.participant?.identity}`, 'livekit');
          monitoringService.recordMetric('livekit.tracks.published', 1, { 
            type: eventData.track?.type 
          });
          break;
          
        case 'track_unpublished':
          log(`Track unpublished: ${eventData.track?.type} by ${eventData.participant?.identity}`, 'livekit');
          monitoringService.recordMetric('livekit.tracks.unpublished', 1, { 
            type: eventData.track?.type 
          });
          break;
          
        default:
          log(`Unknown LiveKit event: ${eventType}`, 'livekit');
      }
    } catch (error) {
      log(`Error handling webhook event: ${error}`, 'livekit');
      monitoringService.trackError('livekit_webhook', `Event handling failed: ${error}`);
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      service: 'livekit',
      status: 'healthy',
      config: {
        hasApiKey: !!this.config.apiKey,
        hasApiSecret: !!this.config.apiSecret,
        wsUrl: this.config.wsUrl
      },
      timestamp: new Date().toISOString()
    };
  }
}

export const liveKitService = new LiveKitService();
export type { ParticipantInfo };