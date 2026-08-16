import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MobileNav } from './components/layout/MobileNav';
import { Footer } from './components/layout/Footer';
import type { PageType, AnalyticsData, LiveStreamTelemetry } from './types/analytics';
import { CrowdApiError, getApiErrorMessage, getHealth, getReadiness } from './api/crowdApi';
import { mapLiveStreamTelemetry } from './api/telemetryMapper';
import { mapAnalyticsPayload } from './api/analyticsMapper';
import type { ApiAvailability } from './api/contracts';
import { translations, type Language } from './i18n/translations';

// Keep the shell and API health check in the initial bundle. Each dashboard
// surface is loaded only when selected, which keeps the first paint small and
// moves optional dependencies such as Recharts out of the entry chunk.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then(({ OverviewPage: page }) => ({ default: page })));
const LivePage = lazy(() => import('./pages/LivePage').then(({ LivePage: page }) => ({ default: page })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(({ AnalyticsPage: page }) => ({ default: page })));
const RoomSetupPage = lazy(() => import('./pages/RoomSetupPage').then(({ RoomSetupPage: page }) => ({ default: page })));
const SystemPage = lazy(() => import('./pages/SystemPage').then(({ SystemPage: page }) => ({ default: page })));
const VideoPage = lazy(() => import('./pages/VideoPage').then(({ VideoPage: page }) => ({ default: page })));

function createEmptyAnalytics(): AnalyticsData {
  return {
    total_crowd: 0,
    occupancy_rate: null,
    density_per_m2: null,
    seats_occupied: null,
    total_seats: 0,
    moving_count: 0,
    stationary_count: 0,
    flow_in: 0,
    flow_out: 0,
    net_flow: 0,
    visual_presentation: { female_presenting: 0, male_presenting: 0, unknown: 0, coverage_pct: 0 },
    space_distribution: { front_pct: 0, middle_pct: 0, back_pct: 0 },
    zones: [],
  };
}

function PageLoading() {
  return (
    <div className="p-6 max-w-7xl mx-auto" role="status" aria-live="polite">
      <div className="cyber-card p-6 rounded-xl text-sm font-mono text-cyan-300">Loading dashboard module...</div>
    </div>
  );
}

export function App() {
  const [activePage, setActivePage] = useState<PageType>('overview');
  const [currentRoom, setCurrentRoom] = useState('Classroom A');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiAvailability>('checking');
  const [livePageMounted, setLivePageMounted] = useState(false);

  // Language State ('vi' | 'en') - Default to Vietnamese ('vi')
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('crowd_analytics_lang') as Language) || 'vi';
  });

  const toggleLanguage = () => {
    const nextLang = lang === 'vi' ? 'en' : 'vi';
    setLang(nextLang);
    localStorage.setItem('crowd_analytics_lang', nextLang);
  };

  const t = translations[lang];

  // Keep the live camera/session worker mounted after the first visit. The
  // previous tabbed UI intentionally preserved this page while hidden, so
  // switching to analytics or room setup must not tear down an active stream.
  useEffect(() => {
    if (activePage === 'live') setLivePageMounted(true);
  }, [activePage]);

  // Analytics data state
  const [analytics, setAnalytics] = useState<AnalyticsData>(createEmptyAnalytics);

  const [telemetry, setTelemetry] = useState<LiveStreamTelemetry>({});

  // Handle Real AI Model Output from Live Page
  const handleAnalyticsUpdate = useCallback((rawStats: any) => {
    if (!rawStats) return;
    setAnalytics((prev) => mapAnalyticsPayload(rawStats, prev));
  }, []);

  const handleTelemetryUpdate = useCallback((rawTelemetry: Record<string, any>) => {
    setTelemetry((prev) => ({ ...prev, ...mapLiveStreamTelemetry(rawTelemetry) }));
  }, []);

  const handleSessionChange = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
    if (sessionId === null) setAnalytics(createEmptyAnalytics());
  }, []);

  const [vietnamTime, setVietnamTime] = useState('');
  const [isLiveStreamActive, setIsLiveStreamActive] = useState(false);

  // Live System Event Logs
  const [systemLogs, setSystemLogs] = useState<string[]>(() => [
    `[${new Date().toLocaleTimeString('vi-VN')}] [SYSTEM] Crowd Analytics Telemetry Engine online.`,
    `[${new Date().toLocaleTimeString('vi-VN')}] [INFO] YOLO11n + FastTracker backend pipeline initialized.`,
  ]);

  const addSystemLog = (msg: string) => {
    const timeStr = new Date().toLocaleTimeString('vi-VN');
    setSystemLogs((prev) => [...prev.slice(-99), `[${timeStr}] ${msg}`]);
  };

  // Service health/readiness is independent from live session ownership.
  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        await getHealth(controller.signal);
        const readiness = await getReadiness(controller.signal);
        if (!controller.signal.aborted) {
          setApiStatus(readiness.ready ? 'ready' : 'not_ready');
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setApiStatus(error instanceof CrowdApiError && error.status === 503 ? 'not_ready' : 'offline');
        addSystemLog(`[WARN] API readiness check failed: ${getApiErrorMessage(error, 'Unknown API error')}`);
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  // Real-time Vietnam Time (Asia/Ho_Chi_Minh) Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setVietnamTime(timeStr);
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen flex flex-col font-sans transition-colors duration-300">
      <Header
        currentRoom={currentRoom}
        onRoomChange={setCurrentRoom}
        sessionDuration={vietnamTime}
        lang={lang}
        onToggleLanguage={toggleLanguage}
        t={t}
        isLive={isLiveStreamActive}
        apiStatus={apiStatus}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar activePage={activePage} onPageChange={setActivePage} t={t} />

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0 transition-colors duration-300">
          <Suspense fallback={<PageLoading />}>
            {activePage === 'overview' && (
              <OverviewPage
                analytics={analytics}
                roomCalibrated={analytics.density_per_m2 !== null}
                roomName={currentRoom}
                t={t}
              />
            )}

            {(activePage === 'live' || livePageMounted) && (
              <div className={activePage === 'live' ? 'block' : 'hidden'}>
                <LivePage
                  analytics={analytics}
                  onAnalyticsUpdate={handleAnalyticsUpdate}
                  onTelemetryUpdate={handleTelemetryUpdate}
                  t={t}
                  onStreamingChange={setIsLiveStreamActive}
                  onSessionChange={handleSessionChange}
                  addSystemLog={addSystemLog}
                />
              </div>
            )}

            {activePage === 'analytics' && <AnalyticsPage analytics={analytics} t={t} />}

            {activePage === 'room' && <RoomSetupPage t={t} sessionId={activeSessionId} />}

            {activePage === 'system' && (
              <SystemPage telemetry={telemetry} t={t} logs={systemLogs} isLive={isLiveStreamActive} />
            )}

            {activePage === 'video' && <VideoPage />}
          </Suspense>
        </main>
      </div>

      <Footer telemetry={telemetry} t={t} isLive={isLiveStreamActive} />
      <MobileNav activePage={activePage} onPageChange={setActivePage} t={t} />
    </div>
  );
}

export default App;
