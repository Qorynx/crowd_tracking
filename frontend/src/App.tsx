import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MobileNav } from './components/layout/MobileNav';
import type { PageType, AnalyticsData, LiveStreamTelemetry } from './types/analytics';
import { CrowdApiError, getHealth, getReadiness } from './api/crowdApi';
import { mapLiveStreamTelemetry } from './api/telemetryMapper';
import { mapAnalyticsPayload } from './api/analyticsMapper';
import type { ApiAvailability } from './api/contracts';
import { translations, type Language } from './i18n/translations';

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
    flow_in_per_minute: 0,
    flow_out_per_minute: 0,
    net_flow_per_minute: 0,
    visual_presentation: { female_presenting: 0, male_presenting: 0, unknown: 0, coverage_pct: 0 },
    space_distribution: { front_pct: 0, middle_pct: 0, back_pct: 0 },
    zones: [],
  };
}

function PageLoading() {
  return (
    <div className="p-8 max-w-7xl mx-auto" role="status" aria-live="polite">
      <div className="bg-surface-primary border border-border-default p-6 rounded-lg text-sm text-text-muted">
        Loading module...
      </div>
    </div>
  );
}

export function App() {
  const [activePage, setActivePage] = useState<PageType>('overview');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiAvailability>('checking');
  const [livePageMounted, setLivePageMounted] = useState(false);
  const isLivePageVisible = activePage === 'live';

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

  // Preserve live session and camera worker across page changes
  useEffect(() => {
    if (activePage === 'live') setLivePageMounted(true);
  }, [activePage]);

  // Analytics data state
  const [analytics, setAnalytics] = useState<AnalyticsData>(createEmptyAnalytics);
  const [telemetry, setTelemetry] = useState<LiveStreamTelemetry>({});

  // Handle Real Model Output from Live Page
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

  const [isLiveStreamActive, setIsLiveStreamActive] = useState(false);

  // Service health and readiness check
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
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-app-bg text-text-primary flex">
      {/* Shared Desktop Sidebar */}
      <Sidebar activePage={activePage} onPageChange={setActivePage} t={t} />

      {/* Main Content Shell */}
      <div className="flex-1 md:ml-[224px] flex flex-col min-h-screen">
        {/* Top Header */}
        <Header
          lang={lang}
          onToggleLanguage={toggleLanguage}
          t={t}
          isLive={isLiveStreamActive}
          apiStatus={apiStatus}
        />

        {/* Page Content Canvas */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-6">
          {/* Keep the camera/session in its own Suspense boundary. Loading a
              different lazy page must never replace this subtree and trigger
              LivePage's unmount cleanup. */}
          {(isLivePageVisible || livePageMounted) && (
            <Suspense fallback={isLivePageVisible ? <PageLoading /> : null}>
              <div
                className={isLivePageVisible ? 'block' : 'fixed w-px h-px overflow-hidden opacity-0 pointer-events-none'}
                style={isLivePageVisible ? undefined : { left: '-10000px', top: 0 }}
                aria-hidden={!isLivePageVisible}
              >
                <LivePage
                  analytics={analytics}
                  onAnalyticsUpdate={handleAnalyticsUpdate}
                  onTelemetryUpdate={handleTelemetryUpdate}
                  t={t}
                  isVisible={isLivePageVisible}
                  onStreamingChange={setIsLiveStreamActive}
                  onSessionChange={handleSessionChange}
                />
              </div>
            </Suspense>
          )}

          <Suspense fallback={<PageLoading />}>
            {activePage === 'overview' && (
              <OverviewPage
                analytics={analytics}
                roomCalibrated={analytics.density_per_m2 !== null}
                roomName={t.classroomA}
                isLive={isLiveStreamActive}
                apiStatus={apiStatus}
                t={t}
              />
            )}

            {activePage === 'analytics' && (
              <AnalyticsPage analytics={analytics} t={t} isLive={isLiveStreamActive} />
            )}

            {activePage === 'room' && <RoomSetupPage t={t} sessionId={activeSessionId} />}

            {activePage === 'system' && (
              <SystemPage telemetry={telemetry} t={t} isLive={isLiveStreamActive} apiStatus={apiStatus} />
            )}

            {activePage === 'video' && <VideoPage isLive={isLiveStreamActive} />}
          </Suspense>
        </main>
      </div>

      {/* Mobile Navigation Bar */}
      <MobileNav activePage={activePage} onPageChange={setActivePage} t={t} />
    </div>
  );
}

export default App;
