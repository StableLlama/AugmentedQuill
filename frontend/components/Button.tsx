import React from 'react';
import { AppTheme } from '../types';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  theme?: AppTheme;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  icon,
  className = '',
  theme = 'dark', // Default to dark/mixed behavior
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border";
  
  const isLight = theme === 'light';

  const variants = {
    primary: "bg-amber-600 text-white border-transparent hover:bg-amber-700 focus:ring-amber-500",
    secondary: isLight 
      ? "bg-white text-stone-700 border-stone-300 hover:bg-stone-50 focus:ring-amber-500"
      : "bg-stone-800 text-stone-200 border-stone-700 hover:bg-stone-700 focus:ring-amber-500",
    danger: isLight
      ? "bg-red-100 text-red-800 border-red-200 hover:bg-red-200 focus:ring-red-500"
      : "bg-red-900/50 text-red-200 border-red-900 hover:bg-red-900 focus:ring-red-500",
    ghost: isLight
      ? "text-stone-500 border-transparent hover:bg-stone-200 hover:text-stone-900 focus:ring-stone-400"
      : "text-stone-400 border-transparent hover:bg-stone-800 hover:text-stone-200 focus:ring-stone-500",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon && <span className="mr-2">{icon}</span>}
      {children}
    </button>
  );
};