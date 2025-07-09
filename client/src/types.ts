export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'stranger';
  timestamp: Date;
}

export interface Stranger {
  id: string;
  interests: string[];
  isTyping: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'stranger_disconnected';

export type ChatMode = 'text' | 'video';

export interface VideoCall {
  isActive: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  tags?: string[];
  country?: string;
  isOnline?: boolean;
  lastSeen?: Date;
}