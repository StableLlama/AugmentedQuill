// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the button unit so this responsibility stays isolated, testable, and easy to evolve.
 */

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
  const baseStyles =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border';

  const isLight = theme === 'light';

  const variants = {
    primary: isLight
      ? 'bg-brand-700 text-white border-transparent hover:bg-brand-800 focus:ring-brand-500'
      : 'bg-brand-900/30 text-brand-300 border-brand-800/50 hover:bg-brand-900/50 hover:text-brand-200 focus:ring-brand-500',
    secondary: isLight
      ? 'bg-brand-gray-100 text-brand-gray-800 border-brand-gray-300 hover:bg-brand-gray-200 focus:ring-brand-500'
      : 'bg-brand-gray-800/50 text-brand-gray-300 border-brand-gray-700 hover:bg-brand-gray-800 hover:text-brand-gray-200 focus:ring-brand-500',
    danger: isLight
      ? 'bg-red-600 text-white border-transparent hover:bg-red-700 focus:ring-red-500'
      : 'bg-red-950/30 text-red-300 border-red-900/50 hover:bg-red-950/50 focus:ring-red-500',
    ghost: isLight
      ? 'text-brand-gray-600 border-transparent hover:bg-brand-gray-200 hover:text-brand-gray-900 focus:ring-brand-gray-400'
      : 'text-brand-gray-400 border-transparent hover:bg-brand-gray-800 hover:text-brand-gray-200 focus:ring-brand-gray-500',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
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
