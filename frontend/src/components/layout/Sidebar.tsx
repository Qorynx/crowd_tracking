import React from 'react';
import {
  LayoutDashboard,
  Video,
  BarChart3,
  Sliders,
  FileVideo,
  Settings,
} from 'lucide-react';
import type { PageType } from '@/types/analytics';

interface SidebarProps {
  activePage: PageType;
  onPageChange: (page: PageType) => void;
  t: any;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, onPageChange, t }) => {
  const navItems: { id: PageType; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'overview', label: t.overview, icon: LayoutDashboard },
    { id: 'live', label: t.live, icon: Video },
    { id: 'analytics', label: t.analytics, icon: BarChart3 },
    { id: 'room', label: t.room, icon: Sliders },
    { id: 'video', label: t.video, icon: FileVideo },
    { id: 'system', label: t.system, icon: Settings },
  ];

  return (
    <nav className="bg-sidebar-bg fixed left-0 top-0 h-full w-[224px] hidden md:flex flex-col py-6 z-50 border-r border-border-default shrink-0">
      {/* Brand Header */}
      <div className="px-6 mb-8">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight leading-tight">
          Crowd<br />Analytics
        </h1>
        <p className="text-xs text-text-muted mt-1 uppercase tracking-wider">
          {t.brandSub}
        </p>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors text-left cursor-pointer ${
                isActive
                  ? 'bg-surface-container-high text-primary font-semibold border border-border-default'
                  : 'text-text-muted hover:bg-surface-container-highest hover:text-text-primary'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-text-muted'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* User identity */}
      <div className="mt-auto px-6 pt-4 border-t border-border-default">
        <span className="text-sm font-semibold text-text-primary">Qorynx</span>
      </div>
    </nav>
  );
};
