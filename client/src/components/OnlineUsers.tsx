import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { Users, Globe, Clock } from 'lucide-react';

interface OnlineUser {
  id: string;
  name: string;
  avatar?: string;
  tags: string[];
  country: string;
  joinedAt: number;
}

interface PresenceEvent {
  type: 'user_online' | 'user_offline' | 'user_activity' | 'bulk_update';
  user?: OnlineUser;
  users?: OnlineUser[];
  timestamp: number;
}

interface OnlineUsersProps {
  socket?: Socket;
  currentUserId?: string;
  showFilters?: boolean;
  maxUsers?: number;
}

interface OnlineUsersResponse {
  users: OnlineUser[];
  total: number;
}

export default function OnlineUsers({ 
  socket, 
  currentUserId, 
  showFilters = true, 
  maxUsers = 50 
}: OnlineUsersProps) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');

  // Fetch initial online users
  const { data: initialUsers, isLoading } = useQuery<OnlineUsersResponse>({
    queryKey: ['/api/presence/online'],
    queryFn: async () => {
      const response = await fetch('/api/presence/online');
      if (!response.ok) {
        throw new Error('Failed to fetch online users');
      }
      return response.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds as fallback
    enabled: !socket, // Only fetch if no socket connection
  });

  // Real-time presence updates via Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handlePresenceUpdate = (event: PresenceEvent) => {
      switch (event.type) {
        case 'user_online':
          if (event.user && event.user.id !== currentUserId) {
            setOnlineUsers(prev => {
              const filtered = prev.filter(u => u.id !== event.user!.id);
              return [...filtered, event.user!];
            });
          }
          break;

        case 'user_offline':
          if (event.user) {
            setOnlineUsers(prev => prev.filter(u => u.id !== event.user!.id));
          }
          break;

        case 'bulk_update':
          if (event.users) {
            const filteredUsers = event.users.filter(u => u.id !== currentUserId);
            setOnlineUsers(filteredUsers);
          }
          break;

        case 'user_activity':
          // Optional: Update last activity indicator
          if (event.user) {
            setOnlineUsers(prev => 
              prev.map(u => u.id === event.user!.id ? { ...u, ...event.user } : u)
            );
          }
          break;
      }
    };

    // Subscribe to presence updates
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('presence:bulk_update', handlePresenceUpdate);
    socket.on('presence:activity', handlePresenceUpdate);

    // Request initial presence data
    socket.emit('presence:subscribe');

    return () => {
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('presence:bulk_update', handlePresenceUpdate);
      socket.off('presence:activity', handlePresenceUpdate);
    };
  }, [socket, currentUserId]);

  // Initialize with API data if no socket connection
  useEffect(() => {
    if (initialUsers?.users && !socket) {
      const filteredUsers = initialUsers.users.filter((u: OnlineUser) => u.id !== currentUserId);
      setOnlineUsers(filteredUsers);
    }
  }, [initialUsers, socket, currentUserId]);

  // Filter users based on selected criteria
  const filteredUsers = onlineUsers.filter(user => {
    if (selectedTag !== 'all' && !user.tags.includes(selectedTag)) {
      return false;
    }
    if (selectedCountry !== 'all' && user.country !== selectedCountry) {
      return false;
    }
    return true;
  }).slice(0, maxUsers);

  // Get unique tags and countries for filters
  const allTags = Array.from(new Set(onlineUsers.flatMap(user => user.tags)));
  const allCountries = Array.from(new Set(onlineUsers.map(user => user.country)));

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (isLoading && onlineUsers.length === 0) {
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
        <div className="p-4 border-b">
          <h3 className="flex items-center gap-2 font-semibold">
            <Users className="h-5 w-5" />
            Online Users
          </h3>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
      <div className="p-4 border-b">
        <h3 className="flex items-center gap-2 font-semibold">
          <Users className="h-5 w-5" />
          Online Users ({filteredUsers.length})
        </h3>
        
        {showFilters && (
          <div className="flex flex-wrap gap-2 mt-2">
            <select 
              value={selectedTag} 
              onChange={(e) => setSelectedTag(e.target.value)}
              className="px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="all">All Tags</option>
              {allTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
            
            <select 
              value={selectedCountry} 
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="all">All Countries</option>
              {allCountries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      
      <div className="p-4">
        {filteredUsers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No users online matching your filters
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <div className="space-y-3">
              {filteredUsers.map((user) => (
                <div key={user.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-700">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-medium">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{user.name}</span>
                      <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                    </div>
                    
                    <div className="flex items-center gap-1 mt-1">
                      <Globe className="h-3 w-3 text-gray-400" />
                      <span className="text-xs text-gray-500 truncate">{user.country}</span>
                    </div>
                    
                    {user.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {user.tags.slice(0, 3).map((tag, index) => (
                          <span key={index} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200">
                            {tag}
                          </span>
                        ))}
                        {user.tags.length > 3 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400">
                            +{user.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="h-3 w-3" />
                      {formatTimeAgo(user.joinedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}