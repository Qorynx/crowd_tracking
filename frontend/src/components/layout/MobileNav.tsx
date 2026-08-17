import React from 'react';
import { LayoutDashboard, Video, BarChart3, Sliders, Settings, FileVideo } from 'lucide-react';
import type { PageType } from '../../types/analytics';

interface MobileNavProps {
  activePage: PageType;
  onPageChange: (page: PageType) => void;
  t: any;
}

export const MobileNav: React.FC<MobileNavProps> = ({ activePage, onPageChange, t }) => {
  const navItems: { id: PageType; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'overview', label: t.overview, icon: LayoutDashboard },
    { id: 'live', label: t.live, icon: Video },
    { id: 'analytics', label: t.analytics, icon: BarChart3 },
    { id: 'room', label: t.room, icon: Sliders },
    { id: 'video', label: t.video, icon: FileVideo },
    { id: 'system', label: t.system, icon: Settings },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[68px] bg-sidebar-bg border-t border-border-default flex justify-around items-center z-50 px-2 pb-1 shadow-lg">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activePage === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onPageChange(item.id)}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer flex-1 h-full pt-1 relative transition-colors ${
              isActive ? 'text-primary font-semibold' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {isActive && (
              <div className="absolute top-0 w-8 h-[2px] bg-primary rounded-b-full" />
            )}
            <Icon className="w-5 h-5" />
            <span className="text-[10px] tracking-tight">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
