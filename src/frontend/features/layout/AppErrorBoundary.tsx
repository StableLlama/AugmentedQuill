// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app error boundary unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React from 'react';

type AppErrorBoundaryState = {
  hasError: boolean;
};

export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error('Unhandled UI error', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-brand-gray-50 text-brand-gray-800 p-6">
          <div className="max-w-md text-center space-y-2">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-brand-gray-600">
              Reload the page to continue working. If this keeps happening, check the
              browser console for details.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
