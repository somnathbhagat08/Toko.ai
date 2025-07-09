import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import HomePage from './components/HomePage';
import ChatInterface from './components/ChatInterface';
import ErrorBoundary from './components/ErrorBoundary';
import { ChatMode, Stranger } from './types';
import { socketService } from './services/socketService';

function App() {
  const [user, setUser] = useState<any>(null);
  const [isInChat, setIsInChat] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('text');
  const [roomId, setRoomId] = useState<string>('');
  const [stranger, setStranger] = useState<Stranger | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    // Initialize socket connection when user logs in
    if (user && !socketService.isSocketConnected()) {
      initializeSocket();
    }

    return () => {
      // Cleanup on unmount
      if (socketService.isSocketConnected()) {
        socketService.disconnect();
      }
    };
  }, [user]);

  const initializeSocket = async () => {
    try {
      await socketService.connect();
      console.log('Socket connected successfully');
      
      // Set up match found handler
      socketService.onMatchFound((data) => {
        console.log('Match found:', data);
        setRoomId(data.roomId);
        setStranger(data.stranger);
        setIsInChat(true);
        setIsConnecting(false);
      });

      socketService.onWaitingForMatch(() => {
        console.log('Waiting for match...');
        setIsConnecting(true);
      });

      // Handle connection errors
      socketService.onError?.((error) => {
        console.error('Socket error:', error);
        setIsConnecting(false);
        // Reset to home page on connection error
        setIsInChat(false);
      });

    } catch (error) {
      console.error('Failed to connect to server:', error);
      setIsConnecting(false);
      setIsInChat(false);
      // Could show a toast notification here
    }
  };

  const handleLogin = (userData: any) => {
    setUser(userData);
  };

  const handleLogout = () => {
    if (socketService.isSocketConnected()) {
      socketService.disconnect();
    }
    setUser(null);
    setIsInChat(false);
    setIsConnecting(false);
    setRoomId('');
    setStranger(null);
  };

  const startChat = (interests: string[], mode: ChatMode, genderPreference?: string, countryPreference?: string) => {
    console.log('Starting chat with interests:', interests, 'Mode:', mode, 'Gender preference:', genderPreference, 'Country preference:', countryPreference);
    setChatMode(mode);
    setIsConnecting(true);
    setIsInChat(true); // Go directly to chat interface
    
    // Join the matching queue
    socketService.joinQueue({
      user: {
        ...user,
        gender: user.gender || 'any' // You might want to collect this during registration
      },
      interests,
      chatMode: mode,
      genderPreference: genderPreference || 'any',
      countryPreference: countryPreference || 'Any on Earth'
    });
  };

  const endChat = () => {
    setIsInChat(false);
    setIsConnecting(false);
    setRoomId('');
    setStranger(null);
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col min-h-screen">
        {isInChat ? (
          <ChatInterface 
            onDisconnect={endChat} 
            chatMode={chatMode} 
            user={user}
            roomId={roomId}
            stranger={stranger || undefined}
            isConnecting={isConnecting}
          />
        ) : (
          <HomePage onStartChat={startChat} user={user} onLogout={handleLogout} />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;