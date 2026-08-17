import React from 'react';
import { Bell, Globe } from 'lucide-react';
import type { Language } from '@/i18n/translations';
import type { ApiAvailability } from '@/api/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface HeaderProps {
  lang: Language;
  onToggleLanguage: () => void;
  t: any;
  isLive?: boolean;
  apiStatus: ApiAvailability;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  onToggleLanguage,
  t,
  isLive = false,
  apiStatus,
}) => {
  const statusLabel = isLive
    ? t.liveStatus
    : apiStatus === 'offline'
      ? t.serviceOffline
      : apiStatus === 'not_ready'
        ? t.serviceNotReady
        : apiStatus === 'checking'
          ? t.serviceChecking
          : t.systemReady;
  const statusColor = isLive
    ? 'bg-success animate-pulse'
    : apiStatus === 'offline'
      ? 'bg-danger'
      : apiStatus === 'not_ready' || apiStatus === 'checking'
        ? 'bg-warning'
        : 'bg-success';

  return (
    <header className="h-16 bg-app-bg border-b border-border-default flex justify-between items-center px-4 sm:px-8 sticky top-0 z-40 shrink-0">
      {/* Left: Active Room Context */}
      <div className="flex items-center gap-6 h-full">
        <div className="flex items-center h-full text-text-primary font-semibold text-base">
          {t.classroomA}
        </div>
      </div>

      {/* Right: Actions & Status */}
      <div className="flex items-center gap-4 sm:gap-6">
        {/* Live Status Indicator */}
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            {statusLabel}
          </span>
        </div>

        {/* Language Switcher Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 text-xs font-semibold uppercase text-text-muted hover:text-text-primary transition-colors cursor-pointer outline-none">
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === 'vi' ? 'Tiếng Việt' : 'English'}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                if (lang !== 'vi') onToggleLanguage();
              }}
              className={lang === 'vi' ? 'text-primary font-semibold' : ''}
            >
              Tiếng Việt (VN)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (lang !== 'en') onToggleLanguage();
              }}
              className={lang === 'en' ? 'text-primary font-semibold' : ''}
            >
              English (EN)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Action Icons */}
        <div className="flex items-center gap-3 sm:gap-4 border-l border-border-default pl-4 sm:pl-6">
          <button
            className="text-text-muted hover:text-text-primary transition-colors cursor-pointer active:scale-95"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
