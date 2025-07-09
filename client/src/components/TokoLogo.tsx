import React from 'react';

export default function TokoLogo({ className = "w-12 h-12" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Neobrutalism background square */}
      <rect x="10" y="10" width="80" height="80" fill="#FFFF00" stroke="#000" strokeWidth="4"/>
      
      {/* Main TOKO text box */}
      <rect x="20" y="25" width="60" height="25" fill="#FF69B4" stroke="#000" strokeWidth="3"/>
      
      {/* TOKO text */}
      <text x="50" y="42" fontSize="16" fontWeight="900" textAnchor="middle" fill="#000" fontFamily="Arial Black, sans-serif">TOKO</text>
      
      {/* Chat bubble 1 */}
      <rect x="15" y="55" width="25" height="15" fill="#00FF88" stroke="#000" strokeWidth="2"/>
      <polygon points="15,70 15,75 20,70" fill="#00FF88" stroke="#000" strokeWidth="2"/>
      
      {/* Chat bubble 2 */}
      <rect x="60" y="55" width="25" height="15" fill="#87CEEB" stroke="#000" strokeWidth="2"/>
      <polygon points="85,70 85,75 80,70" fill="#87CEEB" stroke="#000" strokeWidth="2"/>
      
      {/* Connection lines in neobrutalism style */}
      <line x1="27" y1="55" x2="73" y2="55" stroke="#000" strokeWidth="3"/>
      <circle cx="35" cy="55" r="2" fill="#000"/>
      <circle cx="50" cy="55" r="2" fill="#000"/>
      <circle cx="65" cy="55" r="2" fill="#000"/>
      
      {/* Decorative elements */}
      <rect x="22" y="75" width="8" height="8" fill="#FF0000" stroke="#000" strokeWidth="2"/>
      <circle cx="78" cy="79" r="4" fill="#00FF00" stroke="#000" strokeWidth="2"/>
      
      {/* Extra neobrutalism shadow effects */}
      <rect x="22" y="12" width="60" height="25" fill="#000" opacity="0.3"/>
      <rect x="17" y="57" width="25" height="15" fill="#000" opacity="0.3"/>
      <rect x="62" y="57" width="25" height="15" fill="#000" opacity="0.3"/>
    </svg>
  );
}