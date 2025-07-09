import React, { useState, useEffect } from 'react';
import { MessageCircle, Video, Users, Zap, User, Star, Circle, Square, Triangle, UserCheck, Heart, Lock, Unlock, TrendingUp } from 'lucide-react';
import TokoLogo from './TokoLogo';
import InteractiveGlobe from './InteractiveGlobe';

import { io, Socket } from 'socket.io-client';

interface HomePageProps {
  onStartChat: (interests: string[], mode: 'text' | 'video', genderPreference?: string, countryPreference?: string) => void;
  user: any;
  onLogout: () => void;
}

const SUGGESTED_INTERESTS = [
  'Technology', 'Art & Design', 'Music', 'Gaming', 'Business', 'Travel',
  'Photography', 'Fitness', 'Literature', 'Science', 'Philosophy', 'Fashion',
  'Cooking', 'Sports', 'Movies', 'Entrepreneurship', 'Podcasts', 'Dancing'
];

const COUNTRY_OPTIONS = [
  { name: 'Any on Earth', flag: '🌍' },
  { name: 'United States', flag: '🇺🇸' },
  { name: 'United Kingdom', flag: '🇬🇧' },
  { name: 'Canada', flag: '🇨🇦' },
  { name: 'Australia', flag: '🇦🇺' },
  { name: 'Germany', flag: '🇩🇪' },
  { name: 'France', flag: '🇫🇷' },
  { name: 'Spain', flag: '🇪🇸' },
  { name: 'Italy', flag: '🇮🇹' },
  { name: 'Netherlands', flag: '🇳🇱' },
  { name: 'Sweden', flag: '🇸🇪' },
  { name: 'Norway', flag: '🇳🇴' },
  { name: 'India', flag: '🇮🇳' },
  { name: 'Japan', flag: '🇯🇵' },
  { name: 'South Korea', flag: '🇰🇷' },
  { name: 'China', flag: '🇨🇳' },
  { name: 'Singapore', flag: '🇸🇬' },
  { name: 'Brazil', flag: '🇧🇷' },
  { name: 'Mexico', flag: '🇲🇽' },
  { name: 'Argentina', flag: '🇦🇷' },
  { name: 'South Africa', flag: '🇿🇦' },
  { name: 'Nigeria', flag: '🇳🇬' },
  { name: 'Egypt', flag: '🇪🇬' },
  { name: 'Turkey', flag: '🇹🇷' },
  { name: 'Russia', flag: '🇷🇺' },
  { name: 'Poland', flag: '🇵🇱' },
  { name: 'Ukraine', flag: '🇺🇦' },
  { name: 'Czech Republic', flag: '🇨🇿' },
  { name: 'Romania', flag: '🇷🇴' },
  { name: 'Hungary', flag: '🇭🇺' },
  { name: 'Greece', flag: '🇬🇷' },
  { name: 'Portugal', flag: '🇵🇹' },
  { name: 'Belgium', flag: '🇧🇪' },
  { name: 'Austria', flag: '🇦🇹' },
  { name: 'Switzerland', flag: '🇨🇭' },
  { name: 'Denmark', flag: '🇩🇰' },
  { name: 'Finland', flag: '🇫🇮' },
  { name: 'Ireland', flag: '🇮🇪' },
  { name: 'New Zealand', flag: '🇳🇿' },
  { name: 'Thailand', flag: '🇹🇭' },
  { name: 'Vietnam', flag: '🇻🇳' },
  { name: 'Philippines', flag: '🇵🇭' },
  { name: 'Malaysia', flag: '🇲🇾' },
  { name: 'Indonesia', flag: '🇮🇩' },
  { name: 'Pakistan', flag: '🇵🇰' },
  { name: 'Bangladesh', flag: '🇧🇩' },
  { name: 'Sri Lanka', flag: '🇱🇰' },
  { name: 'Israel', flag: '🇮🇱' },
  { name: 'UAE', flag: '🇦🇪' },
  { name: 'Saudi Arabia', flag: '🇸🇦' },
  { name: 'Iran', flag: '🇮🇷' },
  { name: 'Iraq', flag: '🇮🇶' },
  { name: 'Jordan', flag: '🇯🇴' },
  { name: 'Lebanon', flag: '🇱🇧' },
  { name: 'Morocco', flag: '🇲🇦' },
  { name: 'Algeria', flag: '🇩🇿' },
  { name: 'Tunisia', flag: '🇹🇳' },
  { name: 'Kenya', flag: '🇰🇪' },
  { name: 'Ghana', flag: '🇬🇭' },
  { name: 'Ethiopia', flag: '🇪🇹' },
  { name: 'Tanzania', flag: '🇹🇿' },
  { name: 'Uganda', flag: '🇺🇬' },
  { name: 'Zimbabwe', flag: '🇿🇼' },
  { name: 'Botswana', flag: '🇧🇼' },
  { name: 'Namibia', flag: '🇳🇦' },
  { name: 'Chile', flag: '🇨🇱' },
  { name: 'Peru', flag: '🇵🇪' },
  { name: 'Colombia', flag: '🇨🇴' },
  { name: 'Venezuela', flag: '🇻🇪' },
  { name: 'Ecuador', flag: '🇪🇨' },
  { name: 'Uruguay', flag: '🇺🇾' },
  { name: 'Paraguay', flag: '🇵🇾' },
  { name: 'Bolivia', flag: '🇧🇴' }
];

const GENDER_OPTIONS = [
  { 
    id: 'male', 
    label: 'MALE', 
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8" r="5"/>
        <path d="M12 13v8m0 0h-3m3 0h3"/>
        <path d="M15 3l6 6m0 0h-4m4 0v-4"/>
      </svg>
    )
  },
  { 
    id: 'female', 
    label: 'FEMALE', 
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8" r="5"/>
        <path d="M12 13v8m0 0h-3m3 0h3"/>
        <circle cx="12" cy="19" r="2"/>
      </svg>
    )
  },
  { 
    id: 'lgbtq', 
    label: 'LGBTQ+', 
    icon: (
      <div className="w-5 h-5 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 via-indigo-500 to-purple-500 border-2 border-black"></div>
    )
  },
  { 
    id: 'any', 
    label: 'ANY', 
    icon: <Heart className="w-5 h-5" />
  }
];

const HELLO_TEXTS = [
  'Hello', 'Hola', 'Bonjour', 'Hallo', 'Ciao', 'Olá', 'Привет', 'こんにちは', '안녕하세요', '你好', 'مرحبا', 'नमस्ते', 'Γεια σας', 'Shalom', 'Sawubona', 'Jambo',
  'Hej', 'Terve', 'Salam', 'Zdravo', 'Ahoj', 'Dzień dobry', 'Bună', 'Здравей', 'Pozdrav', 'Merhaba', 'سلام', 'Chào', 'สวัสดี', 'ជំរាបសួរ', 'Mingalaba',
  'Halo', 'Kumusta', 'Talofa', 'Kia ora', 'Aloha', 'Habari', 'Sannu', 'Salaam', 'Hujambo', 'Dumela', 'Molweni', 'Avuxeni', 'Ndimadoda', 'Sawubona'
];

interface PlatformStats {
  onlineUsers: number;
  waitingForMatch: number;
  activeChats: number;
  usersInChat: number;
  totalConnections: number;
  averageWaitTime: number;
  serverUptime: number;
  chatModes: Record<string, number>;
  popularInterests: Array<{ interest: string; count: number }>;
  timestamp: number;
}

export default function HomePage({ onStartChat, user, onLogout }: HomePageProps) {
  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState('');
  const [genderPreference, setGenderPreference] = useState<string>('any');
  const [countryPreference, setCountryPreference] = useState<string>('Any on Earth');
  const [showRealName, setShowRealName] = useState(false);
  const [showCountryPopup, setShowCountryPopup] = useState(false);
  const [showInterestPopup, setShowInterestPopup] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [interestSearch, setInterestSearch] = useState('');

  const [socket, setSocket] = useState<Socket | null>(null);
  const [platformStats, setPlatformStats] = useState<PlatformStats>({
    onlineUsers: 1,
    waitingForMatch: 0,
    activeChats: 0,
    usersInChat: 0,
    totalConnections: 1,
    averageWaitTime: 0,
    serverUptime: 0,
    chatModes: {},
    popularInterests: [],
    timestamp: Date.now()
  });

  // Initialize socket connection for real-time features
  useEffect(() => {
    const socketConnection = io();
    setSocket(socketConnection);

    return () => {
      socketConnection.disconnect();
    };
  }, []);

  // Fetch real-time platform statistics
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/platform/stats');
        if (response.ok) {
          const stats = await response.json();
          console.log('Platform stats received:', stats);
          setPlatformStats(stats);
        } else {
          console.error('Failed to fetch stats:', response.status);
        }
      } catch (error) {
        console.error('Failed to fetch platform stats:', error);
      }
    };

    // Fetch initially
    fetchStats();

    // Update every 5 seconds
    const interval = setInterval(fetchStats, 5000);

    return () => clearInterval(interval);
  }, []);

  // Function to mask username for privacy
  const getMaskedUsername = (username: string) => {
    if (!username || username.length <= 3) return '***';
    const maskLength = Math.max(1, username.length - 4);
    return username.substring(0, 2) + '*'.repeat(maskLength) + username.substring(username.length - 2);
  };

  const toggleInterest = (interest: string) => {
    setInterests(prev => 
      prev.includes(interest) 
        ? prev.filter(i => i !== interest)
        : [...prev, interest]
    );
  };

  const addCustomInterest = () => {
    if (customInterest.trim() && !interests.includes(customInterest.trim())) {
      setInterests(prev => [...prev, customInterest.trim()]);
      setCustomInterest('');
    }
  };

  // Filter functions for search
  const filteredCountries = COUNTRY_OPTIONS.filter(country =>
    country.name.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const filteredInterests = SUGGESTED_INTERESTS.filter(interest =>
    interest.toLowerCase().includes(interestSearch.toLowerCase())
  );



  const handleStartChat = (mode: 'text' | 'video') => {
    onStartChat(interests, mode, genderPreference, countryPreference);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 relative overflow-x-hidden">
      {/* Moving Hello Text Background - Grid-based */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Row 1 */}
        <div className="absolute top-[8%] left-0 w-full">
          <div className="animate-marquee whitespace-nowrap opacity-20 text-2xl font-normal text-gray-800 font-mono">
            {HELLO_TEXTS.slice(0, 8).map((text, i) => (
              <span key={i} className="mx-8">{text}</span>
            ))}
          </div>
        </div>

        {/* Row 3 */}
        <div className="absolute top-[24%] left-0 w-full">
          <div className="animate-marquee-reverse whitespace-nowrap opacity-20 text-2xl font-normal text-gray-800 font-mono">
            {HELLO_TEXTS.slice(8, 16).map((text, i) => (
              <span key={i} className="mx-8">{text}</span>
            ))}
          </div>
        </div>

        {/* Row 5 */}
        <div className="absolute top-[40%] left-0 w-full">
          <div className="animate-marquee whitespace-nowrap opacity-20 text-2xl font-normal text-gray-800 font-mono">
            {HELLO_TEXTS.slice(16, 24).map((text, i) => (
              <span key={i} className="mx-8">{text}</span>
            ))}
          </div>
        </div>

        {/* Row 7 */}
        <div className="absolute top-[56%] left-0 w-full">
          <div className="animate-marquee-reverse whitespace-nowrap opacity-20 text-2xl font-normal text-gray-800 font-mono">
            {HELLO_TEXTS.slice(24, 32).map((text, i) => (
              <span key={i} className="mx-8">{text}</span>
            ))}
          </div>
        </div>

        {/* Row 9 */}
        <div className="absolute top-[72%] left-0 w-full">
          <div className="animate-marquee whitespace-nowrap opacity-20 text-2xl font-normal text-gray-800 font-mono">
            {HELLO_TEXTS.slice(32, 40).map((text, i) => (
              <span key={i} className="mx-8">{text}</span>
            ))}
          </div>
        </div>

        {/* Row 11 */}
        <div className="absolute top-[88%] left-0 w-full">
          <div className="animate-marquee-reverse whitespace-nowrap opacity-20 text-2xl font-normal text-gray-800 font-mono">
            {HELLO_TEXTS.slice(40).map((text, i) => (
              <span key={i} className="mx-8">{text}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Dotted Grid Background */}
      <div 
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage: `
            radial-gradient(circle, #000 1.5px, transparent 1.5px),
            linear-gradient(to right, #000 0.8px, transparent 0.8px),
            linear-gradient(to bottom, #000 0.8px, transparent 0.8px)
          `,
          backgroundSize: '50px 50px, 50px 50px, 50px 50px'
        }}
      />

      {/* Enhanced Geometric Shapes Background - 1.5x More Components with 20% Transparency */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Stars - 1.5x quantity */}
        {[...Array(23)].map((_, i) => (
          <div
            key={`star-${i}`}
            className="absolute opacity-20 animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
              fontSize: `${Math.random() * 50 + 40}px`,
              animationDelay: `${i * 0.2}s`
            }}
          >
            <Star className="fill-current text-green-500" />
          </div>
        ))}

        {/* Circles - 1.5x quantity */}
        {[...Array(18)].map((_, i) => (
          <div
            key={`circle-${i}`}
            className="absolute opacity-20 animate-bounce"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              fontSize: `${Math.random() * 60 + 35}px`,
              animationDelay: `${i * 0.3}s`,
              animationDuration: '3s'
            }}
          >
            <Circle className="fill-current text-cyan-400" />
          </div>
        ))}

        {/* Squares - 1.5x quantity */}
        {[...Array(15)].map((_, i) => (
          <div
            key={`square-${i}`}
            className="absolute opacity-20 animate-spin"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 45}deg)`,
              fontSize: `${Math.random() * 45 + 30}px`,
              animationDelay: `${i * 0.4}s`,
              animationDuration: '4s'
            }}
          >
            <Square className="fill-current text-purple-500" />
          </div>
        ))}

        {/* Triangles - 1.5x quantity */}
        {[...Array(12)].map((_, i) => (
          <div
            key={`triangle-${i}`}
            className="absolute opacity-20 animate-ping"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
              fontSize: `${Math.random() * 40 + 25}px`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: '2s'
            }}
          >
            <Triangle className="fill-current text-orange-500" />
          </div>
        ))}

        {/* People Icons - 1.5x quantity */}
        {[...Array(30)].map((_, i) => (
          <div
            key={`user-${i}`}
            className="absolute opacity-20 text-black"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transform: `rotate(${Math.random() * 360}deg)`,
              fontSize: `${Math.random() * 50 + 30}px`
            }}
          >
            <User />
          </div>
        ))}
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-5 py-2 min-h-screen flex flex-col">
        {/* New Header Layout - Responsive */}
        <div className="flex flex-col sm:grid sm:grid-cols-3 items-center gap-4 sm:gap-0 mb-4 sm:mb-6 pt-4 sm:items-start">
          {/* Left: Logo */}
          <div className="flex items-center gap-3 justify-start">
            <div className="bg-white border-3 border-black p-2 shadow-[4px_4px_0px_0px_#000]">
              <TokoLogo className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-black tracking-tight">TOKO</h1>
          </div>

          {/* Center: Live Platform Stats - Mobile responsive */}
          <div className="flex justify-center w-full sm:w-auto sm:justify-self-center">
            <div className="flex flex-col sm:flex-row items-center gap-2 bg-white border-2 border-black px-3 py-2 shadow-[3px_3px_0px_0px_#000] w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-black" />
                <span className="font-black text-xs text-black">LIVE STATS</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 sm:ml-2">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-xs font-bold">{platformStats?.onlineUsers || 0}</span>
                  <span className="text-xs text-gray-600 hidden sm:inline">Online</span>
                  <span className="text-xs text-gray-600 sm:hidden">On</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-xs font-bold">{platformStats?.waitingForMatch || 0}</span>
                  <span className="text-xs text-gray-600 hidden sm:inline">Waiting</span>
                  <span className="text-xs text-gray-600 sm:hidden">Wait</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-xs font-bold">{platformStats.activeChats}</span>
                  <span className="text-xs text-gray-600 hidden sm:inline">Chatting</span>
                  <span className="text-xs text-gray-600 sm:hidden">Chat</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: User info and logout - Mobile responsive */}
          <div className="flex items-center gap-2 sm:gap-3 justify-center sm:justify-end w-full sm:w-auto">
            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              <p className="font-black text-sm sm:text-base text-black whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px] sm:max-w-[120px]">
                {showRealName ? (user.name || user.username) : getMaskedUsername(user.name || user.username)}
              </p>
              <button
                onClick={() => setShowRealName(!showRealName)}
                className="text-black hover:text-green-600 transition-colors flex-shrink-0"
                title={showRealName ? "Hide name for privacy" : "Show real name"}
              >
                {showRealName ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={onLogout}
              className="bg-black text-white border-3 border-black px-3 sm:px-4 py-2 font-black transition-all shadow-[4px_4px_0px_0px_#666] hover:shadow-[5px_5px_0px_0px_#00FF88] hover:bg-green-400 hover:translate-x-[-1px] hover:translate-y-[-1px] active:shadow-[3px_3px_0px_0px_#8A2BE2] active:bg-purple-500 flex-shrink-0 text-xs sm:text-sm"
            >
              LOGOUT
            </button>
          </div>
        </div>

        {/* Header - Mobile responsive */}
        <div className="text-center mb-4 px-2">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg sm:text-xl font-black text-gray-900 mb-2">
              CONNECT • DISCOVER • EXPLORE
            </h2>
            <p className="text-sm sm:text-base font-bold text-gray-700 leading-relaxed">
              "Every stranger is a friend you haven't met yet"
            </p>
          </div>
        </div>

        {/* Main Selection Grid - Responsive for mobile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4 flex-1 auto-rows-fr">

          {/* Gender Preference - Extended height */}
          <div className="bg-white border-4 border-black p-4 shadow-[8px_8px_0px_0px_#000] h-full flex flex-col">
            <h3 className="text-lg font-black mb-3 flex items-center gap-2 text-black">
              <UserCheck className="w-5 h-5" />
              PREFERRED GENDER
            </h3>

            <div className="grid grid-cols-2 gap-3 flex-grow">
              {GENDER_OPTIONS.map(option => (
                <button
                  key={option.id}
                  onClick={() => setGenderPreference(option.id)}
                  className={`p-3 border-2 border-black font-bold transition-all shadow-[2px_2px_0px_0px_#000] hover:shadow-[3px_3px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] text-sm flex flex-col items-center gap-2 ${
                    genderPreference === option.id
                      ? 'bg-black text-white hover:bg-green-400'
                      : 'bg-gray-100 text-black hover:bg-green-200'
                  }`}
                >
                  <div>{option.icon}</div>
                  {option.label}
                </button>
              ))}
            </div>

            {/* Tip section */}
            <div className="mt-4 p-2 bg-gray-50 border-2 border-black">
              <p className="text-xs font-bold text-gray-700 text-center">
                <span className="text-green-600">💡</span> Choose "ANY" for fastest connections<br/>
                Specific selection improves match quality
              </p>
            </div>
          </div>

          {/* Country Preference - Popup */}
          <div className="bg-white border-4 border-black p-4 shadow-[8px_8px_0px_0px_#000] h-full flex flex-col">
            <h3 className="text-lg font-black mb-3 flex items-center gap-2 text-black">
              <div className="w-5 h-5 rounded-full bg-green-400 border-2 border-black"></div>
              COUNTRY
            </h3>

            {/* Select button */}
            <div className="mb-3">
              <button
                onClick={() => setShowCountryPopup(true)}
                className="w-full px-3 py-3 border-3 border-black font-black bg-gradient-to-r from-green-400 to-blue-500 text-black focus:outline-none hover:from-yellow-400 hover:to-pink-500 text-sm shadow-[3px_3px_0px_0px_#000] hover:shadow-[4px_4px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] cursor-pointer"
              >
                SELECT COUNTRY
              </button>
            </div>

            {/* Selected display */}
            <div className="mb-3">
              <div className="text-sm font-bold mb-2">Selected:</div>
              <span className="bg-black text-white px-3 py-2 text-sm font-bold rounded flex items-center gap-2">
                <span className="flag-emoji">{COUNTRY_OPTIONS.find(c => c.name === countryPreference)?.flag}</span> {countryPreference}
              </span>
            </div>

            {/* Info section */}
            <div className="mt-auto p-3 bg-gray-50 border-2 border-black">
              <p className="text-xs font-bold text-gray-700 text-center">
                <span className="text-green-600">🌍</span> Choose "Any on Earth" for global connections<br/>
                Specific countries help find local matches
              </p>
            </div>
          </div>

          {/* Interests - Popup */}
          <div className="bg-white border-4 border-black p-4 shadow-[8px_8px_0px_0px_#000] h-full flex flex-col">
            <h3 className="text-lg font-black mb-3 flex items-center gap-2 text-black">
              <Users className="w-5 h-5" />
              INTERESTS
            </h3>

            {/* Add custom interest */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Add custom interest..."
                value={customInterest}
                onChange={(e) => setCustomInterest(e.target.value)}
                className="w-full px-3 py-2 border-2 border-black font-bold bg-gray-50 focus:outline-none focus:bg-white focus:border-purple-400 text-sm mb-2"
                onKeyPress={(e) => e.key === 'Enter' && addCustomInterest()}
              />
              <button
                onClick={addCustomInterest}
                className="w-full px-6 py-2 border-2 border-black font-black bg-purple-400 text-black hover:bg-purple-300 shadow-[2px_2px_0px_0px_#000] text-sm"
              >
                ADD
              </button>
            </div>

            {/* Select button */}
            <div className="mb-3">
              <button
                onClick={() => setShowInterestPopup(true)}
                className="w-full px-3 py-3 border-3 border-black font-black bg-gradient-to-r from-purple-400 to-pink-500 text-black focus:outline-none hover:from-yellow-400 hover:to-green-500 text-sm shadow-[3px_3px_0px_0px_#000] hover:shadow-[4px_4px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] cursor-pointer"
              >
                SELECT INTERESTS
              </button>
            </div>

            {/* Selected interests display */}
            <div className="mb-3">
              <div className="text-sm font-bold mb-2">
                Selected ({interests.length}):
              </div>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {interests.map(interest => (
                  <span
                    key={interest}
                    className="bg-black text-white px-2 py-1 text-xs font-bold rounded flex items-center gap-1 cursor-pointer hover:bg-red-600"
                    onClick={() => setInterests(interests.filter(i => i !== interest))}
                    title="Click to remove"
                  >
                    {interest}
                    <span className="text-red-300">×</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Info section */}
            <div className="mt-auto p-3 bg-gray-50 border-2 border-black">
              <p className="text-xs font-bold text-gray-700 text-center">
                <span className="text-purple-600">💡</span> Add interests to find like-minded people<br/>
                Click selected interests to remove them
              </p>
            </div>
          </div>

          {/* Chat Mode Section - Extended height */}
          <div className="bg-white border-4 border-black p-4 shadow-[8px_8px_0px_0px_#000] h-full flex flex-col">
            <h3 className="text-lg font-black mb-3 text-center text-black">
              START CHATTING
            </h3>

            <div className="bg-gradient-to-r from-green-400 to-blue-500 border-2 border-black p-2 mb-4 shadow-[3px_3px_0px_0px_#000]">
              <p className="font-bold text-black text-sm text-center">
                Ready to connect?
              </p>
            </div>

            {/* Chat Buttons Container - Proper 2-column layout */}
            <div className="flex-grow flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 flex-1">
                {/* Text Chat Button */}
                <button
                  onClick={() => handleStartChat('text')}
                  className="w-full bg-black text-white hover:bg-green-400 border-3 border-black px-4 py-4 text-sm font-black transition-all shadow-[4px_4px_0px_0px_#000] hover:shadow-[6px_6px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] active:bg-purple-500 flex items-center justify-center gap-3 touch-manipulation min-h-[80px]"
                >
                  <MessageCircle className="w-6 h-6 sm:w-8 sm:h-8" />
                  <span className="text-base sm:text-lg">TEXT CHAT</span>
                </button>

                {/* Video Chat Button */}
                <button
                  onClick={() => handleStartChat('video')}
                  className="w-full bg-black text-white hover:bg-green-400 border-3 border-black px-4 py-4 text-sm font-black transition-all shadow-[4px_4px_0px_0px_#000] hover:shadow-[6px_6px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] active:bg-purple-500 flex items-center justify-center gap-3 touch-manipulation min-h-[80px]"
                >
                  <Video className="w-6 h-6 sm:w-8 sm:h-8" />
                  <span className="text-base sm:text-lg">VIDEO CHAT</span>
                </button>
              </div>

              {/* Info section */}
              <div className="mt-auto p-3 bg-gray-50 border-2 border-black">
                <p className="text-xs font-bold text-gray-700 text-center">
                  <span className="text-green-600">🚀</span> Choose your preferred chat mode<br/>
                  Both modes support instant matching
                </p>
              </div>
            </div>
          </div>


        </div>

        {/* Made by Humans using AI Footer - Mobile responsive */}
        <div className="text-center mt-auto py-2 px-2">
          <p className="text-xs sm:text-sm font-black text-gray-700">
            Made by Humans using AI 🤖
          </p>
        </div>
      </div>

      {/* Country Selection Globe */}
      {showCountryPopup && (
        <InteractiveGlobe
          selectedCountry={countryPreference}
          onSelectCountry={(country) => {
            setCountryPreference(country);
            setShowCountryPopup(false);
          }}
          onClose={() => setShowCountryPopup(false)}
        />
      )}

      {/* Interest Selection Popup - Mobile responsive */}
      {showInterestPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white border-4 border-black p-4 sm:p-6 shadow-[8px_8px_0px_0px_#000] max-w-md w-full max-h-[90vh] sm:max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg sm:text-xl font-black text-black">SELECT INTERESTS</h3>
              <button
                onClick={() => setShowInterestPopup(false)}
                className="bg-red-500 text-white border-2 border-black px-3 py-1 font-black hover:bg-red-600 shadow-[2px_2px_0px_0px_#000]"
              >
                ✕
              </button>
            </div>

            {/* Trending tag */}
            <div className="mb-4">
              <div className="bg-gradient-to-r from-purple-400 to-pink-500 border-2 border-black p-2 shadow-[2px_2px_0px_0px_#000]">
                <p className="font-black text-black text-sm text-center">
                  🔥 TRENDING INTERESTS
                </p>
              </div>
            </div>

            {/* Interests grid - scrollable, mobile responsive */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SUGGESTED_INTERESTS.map(interest => (
                  <button
                    key={interest}
                    onClick={() => {
                      if (!interests.includes(interest)) {
                        setInterests([...interests, interest]);
                      }
                    }}
                    disabled={interests.includes(interest)}
                    className={`p-3 border-3 border-black font-black transition-all shadow-[3px_3px_0px_0px_#000] hover:shadow-[4px_4px_0px_0px_#00FF88] hover:translate-x-[-1px] hover:translate-y-[-1px] text-xs ${
                      interests.includes(interest)
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed border-gray-600'
                        : 'bg-black text-white hover:bg-gray-800'
                    }`}
                  >
                    {interest}
                    {interests.includes(interest) && (
                      <span className="block text-gray-400 mt-1 font-black">✓ Added</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected count */}
            <div className="mt-4 p-2 bg-gray-50 border-2 border-black">
              <p className="text-sm font-bold text-center">
                {interests.length} interests selected
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}