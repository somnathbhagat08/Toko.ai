import React, { useState, useEffect } from 'react';

interface MessageOverlayProps {
  message: string;
  sender: 'user' | 'stranger';
  onComplete?: () => void;
}

export default function MessageOverlay({ message, sender, onComplete }: MessageOverlayProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, 10000); // 10 seconds

    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!isVisible) return null;

  return (
    <div 
      className={`absolute z-20 max-w-xs animate-fade-in ${
        sender === 'user' 
          ? 'bottom-4 left-4' 
          : 'bottom-4 right-4'
      }`}
      style={{
        animation: 'slideInUp 0.3s ease-out, fadeOut 0.5s ease-in 9.5s forwards'
      }}
    >
      <div className={`
        relative p-4 rounded-lg border-3 border-black shadow-[4px_4px_0px_0px_#000]
        ${sender === 'user' 
          ? 'bg-green-400 text-black' 
          : 'bg-blue-400 text-black'
        }
        max-w-full break-words
      `}>
        {/* Message bubble tail */}
        <div className={`
          absolute w-0 h-0 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent
          ${sender === 'user' 
            ? 'border-r-[12px] border-r-green-400 -left-3 top-1/2 transform -translate-y-1/2' 
            : 'border-l-[12px] border-l-blue-400 -right-3 top-1/2 transform -translate-y-1/2'
          }
        `} />
        
        <p className="font-bold text-sm leading-tight">
          {message}
        </p>
        
        {/* Sender indicator */}
        <div className={`
          absolute -top-2 text-xs font-black px-2 py-1 rounded border-2 border-black
          ${sender === 'user' 
            ? 'bg-green-600 text-white left-2' 
            : 'bg-blue-600 text-white right-2'
          }
        `}>
          {sender === 'user' ? 'YOU' : 'STRANGER'}
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="mt-2 h-1 bg-gray-300 border border-black rounded overflow-hidden">
        <div 
          className={`h-full ${sender === 'user' ? 'bg-green-600' : 'bg-blue-600'} animate-progress`}
          style={{
            animation: 'progress 10s linear forwards'
          }}
        />
      </div>
    </div>
  );
}