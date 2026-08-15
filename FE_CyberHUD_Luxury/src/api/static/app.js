/* ==========================================================================
   CYBER-HUD LUXURY APPLICATION LOGIC & REALTIME CHART.JS FLOW WAVEFORM
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Controls & Modes
  const btnModeCam = document.getElementById('btnModeCam');
  const btnModeFile = document.getElementById('btnModeFile');
  const btnSwitchCamera = document.getElementById('btnSwitchCamera');
  const btnStartStream = document.getElementById('btnStartStream');
  const btnStopStream = document.getElementById('btnStopStream');
  const connectionStatus = document.getElementById('connectionStatus');
  const radarSweeper = document.getElementById('radarSweeper');

  // DOM Elements - Video & Canvas
  const webcamVideo = document.getElementById('webcamVideo');
  const outputCanvas = document.getElementById('outputCanvas');
  const canvasCtx = outputCanvas.getContext('2d');
  const fileDropzone = document.getElementById('fileDropzone');
  const fileInput = document.getElementById('fileInput');

  // DOM Elements - Micro Overlay
  const valFps = document.getElementById('valFps');
  const valLatency = document.getElementById('valLatency');

  // DOM Elements - Metrics Cards
  const valTotalCount = document.getElementById('valTotalCount');
  const valMaleCount = document.getElementById('valMaleCount');
  const valFemaleCount = document.getElementById('valFemaleCount');
  const valCheckIn = document.getElementById('valCheckIn');
  const valCheckOut = document.getElementById('valCheckOut');
  const valDensity = document.getElementById('valDensity');
  const barMale = document.getElementById('barMale');
  const barFemale = document.getElementById('barFemale');
  const valGenderRatioPct = document.getElementById('valGenderRatioPct');
  const logConsole = document.getElementById('logConsole');

  // Chart.js Setup
  const flowChartCanvas = document.getElementById('flowChart');
  let flowChart = null;
  const maxChartDataPoints = 20;

  function initChart() {
    if (!flowChartCanvas || typeof Chart === 'undefined') return;

    const ctx = flowChartCanvas.getContext('2d');
    const gradientCyan = ctx.createLinearGradient(0, 0, 0, 120);
    gradientCyan.addColorStop(0, 'rgba(0, 242, 254, 0.45)');
    gradientCyan.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

    const gradientPink = ctx.createLinearGradient(0, 0, 0, 120);
    gradientPink.addColorStop(0, 'rgba(255, 42, 133, 0.35)');
    gradientPink.addColorStop(1, 'rgba(255, 42, 133, 0.0)');

    flowChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array(maxChartDataPoints).fill(''),
        datasets: [
          {
            label: 'Tổng số người',
            data: Array(maxChartDataPoints).fill(0),
            borderColor: '#00f2fe',
            backgroundColor: gradientCyan,
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0
          },
          {
            label: 'Nam',
            data: Array(maxChartDataPoints).fill(0),
            borderColor: '#3b82f6',
            borderWidth: 1.5,
            borderDash: [3, 3],
            tension: 0.4,
            fill: false,
            pointRadius: 0
          },
          {
            label: 'Nữ',
            data: Array(maxChartDataPoints).fill(0),
            borderColor: '#ff2a85',
            backgroundColor: gradientPink,
            borderWidth: 1.5,
            tension: 0.4,
            fill: false,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { display: false },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#94a3b8',
              font: { family: 'Orbitron', size: 9 },
              stepSize: 1
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.06)'
            }
          }
        }
      }
    });
  }

  initChart();

  function updateChart(total, male, female) {
    if (!flowChart) return;

    const timeLabel = new Date().toLocaleTimeString('vi-VN', { minute: '2-digit', second: '2-digit' });
    
    flowChart.data.labels.push(timeLabel);
    flowChart.data.datasets[0].data.push(total);
    flowChart.data.datasets[1].data.push(male);
    flowChart.data.datasets[2].data.push(female);

    if (flowChart.data.labels.length > maxChartDataPoints) {
      flowChart.data.labels.shift();
      flowChart.data.datasets[0].data.shift();
      flowChart.data.datasets[1].data.shift();
      flowChart.data.datasets[2].data.shift();
    }

    flowChart.update();
  }

  // Digital Number Flip Animation Helper
  function setAnimatedValue(element, newValue) {
    if (!element) return;
    if (element.innerText !== String(newValue)) {
      element.classList.add('flip-pulse');
      element.innerText = newValue;
      setTimeout(() => element.classList.remove('flip-pulse'), 250);
    }
  }

  // State Variables
  let isStreaming = false;
  let activeMode = 'camera'; // 'camera' or 'file'
  let facingMode = 'user'; // 'user' (Front) or 'environment' (Back)
  let mediaStream = null;
  let frameIntervalTimer = null;
  let frameRequestInFlight = false;
  let sessionID = null;
  let lastFrameTime = 0;
  let lastRenderedSequence = 0;

  // Keep the mobile/tunnel payload bounded.  The browser may still expose a
  // 1080p/4K camera even when 640x480 is only an `ideal` constraint, so the
  // capture canvas is explicitly downscaled before JPEG encoding.
  const FRAME_INTERVAL_MS = 300;
  const MAX_CAPTURE_WIDTH = 640;
  const MAX_CAPTURE_HEIGHT = 480;
  const JPEG_QUALITY = 0.65;

  // Logging Utility Function
  function addLog(msg, type = 'normal') {
    const timeStr = new Date().toLocaleTimeString('vi-VN');
    const logItem = document.createElement('div');
    logItem.className = `log-item ${type}`;
    logItem.innerText = `[${timeStr}] ${msg}`;
    logConsole.appendChild(logItem);
    logConsole.scrollTop = logConsole.scrollHeight;

    while (logConsole.children.length > 50) {
      logConsole.removeChild(logConsole.firstChild);
    }
  }

  // Switch Between Camera Stream and File Upload Modes
  btnModeCam.addEventListener('click', () => setMode('camera'));
  btnModeFile.addEventListener('click', () => setMode('file'));

  function setMode(mode) {
    activeMode = mode;
    if (mode === 'camera') {
      btnModeCam.classList.add('active');
      btnModeFile.classList.remove('active');
      webcamVideo.style.display = 'block';
      fileDropzone.style.display = 'none';
      btnSwitchCamera.style.display = 'flex';
      addLog('Đã chuyển sang chế độ Camera Live Feed', 'system');
    } else {
      btnModeFile.classList.add('active');
      btnModeCam.classList.remove('active');
      webcamVideo.style.display = 'none';
      fileDropzone.style.display = 'flex';
      btnSwitchCamera.style.display = 'none';
      stopCameraStream();
      addLog('Đã chuyển sang chế độ Phân tích Video File', 'system');
    }
  }

  // Switch Front / Back Camera (Mobile Facing Mode)
  btnSwitchCamera.addEventListener('click', async () => {
    facingMode = (facingMode === 'user') ? 'environment' : 'user';
    addLog(`Đang chuyển sang Camera (${facingMode === 'user' ? 'Trước' : 'Sau'})...`, 'system');
    if (isStreaming) {
      stopCameraStream();
      await startCameraStream();
    }
  });

  // Start Camera Stream & Create Tracker Session
  btnStartStream.addEventListener('click', () => {
    if (activeMode === 'camera') {
      startCameraStream();
    } else {
      if (fileInput.files.length > 0) {
        uploadAndProcessVideo(fileInput.files[0]);
      } else {
        fileInput.click();
      }
    }
  });

  // Stop Camera Stream
  btnStopStream.addEventListener('click', () => {
    stopCameraStream();
  });

  async function startCameraStream() {
    try {
      addLog('Đang khởi tạo Session theo dõi...', 'system');
      const sessionRes = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'classroom_demo', camera_id: 'cyberhud-browser' })
      });

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        sessionID = sessionData.session.id;
        addLog(`Đã khởi tạo Session ID: ${sessionID}`, 'system');
      } else {
        const detail = await sessionRes.text();
        throw new Error(`Không tạo được session (${sessionRes.status}): ${detail}`);
      }

      addLog('Đang yêu cầu quyền truy cập Camera...', 'system');
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      };

      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      webcamVideo.srcObject = mediaStream;
      await webcamVideo.play();

      isStreaming = true;
      lastRenderedSequence = 0;
      lastFrameTime = 0;
      btnStartStream.disabled = true;
      btnStopStream.disabled = false;
      connectionStatus.className = 'hud-status-badge badge-online';
      connectionStatus.querySelector('.status-label').innerText = 'LIVE STREAM';
      radarSweeper.classList.add('active');

      addLog('Camera đã kết nối thành công!', 'system');

      startFrameProcessingLoop();
    } catch (err) {
      addLog(`Không thể mở Camera: ${err.message}`, 'error');
      connectionStatus.className = 'hud-status-badge badge-offline';
      connectionStatus.querySelector('.status-label').innerText = 'ERROR';
    }
  }

  function stopCameraStream() {
    if (frameIntervalTimer) {
      clearTimeout(frameIntervalTimer);
      frameIntervalTimer = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }

    if (sessionID) {
      fetch(`/api/v1/sessions/${sessionID}`, { method: 'DELETE' }).catch(() => {});
      addLog(`Đã đóng Session ID: ${sessionID}`, 'system');
      sessionID = null;
    }

    isStreaming = false;
    frameRequestInFlight = false;
    lastRenderedSequence = 0;
    btnStartStream.disabled = false;
    btnStopStream.disabled = true;
    connectionStatus.className = 'hud-status-badge badge-offline';
    connectionStatus.querySelector('.status-label').innerText = 'STOPPED';
    radarSweeper.classList.remove('active');

    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    addLog('Đã dừng Stream.', 'warn');
  }

  function captureDimensions() {
    const sourceWidth = webcamVideo.videoWidth || MAX_CAPTURE_WIDTH;
    const sourceHeight = webcamVideo.videoHeight || MAX_CAPTURE_HEIGHT;
    const scale = Math.min(
      MAX_CAPTURE_WIDTH / sourceWidth,
      MAX_CAPTURE_HEIGHT / sourceHeight,
      1
    );
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale))
    };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  // Frame Capture & API Transmission Loop.  The next frame is scheduled only
  // after the previous request completes, preventing tunnel/API requests from
  // piling up when inference or network RTT is slower than the target cadence.
  function startFrameProcessingLoop() {
    if (frameIntervalTimer) clearTimeout(frameIntervalTimer);

    const sendNextFrame = async () => {
      if (!isStreaming || webcamVideo.paused || webcamVideo.ended) {
        if (isStreaming) frameIntervalTimer = setTimeout(sendNextFrame, FRAME_INTERVAL_MS);
        return;
      }
      if (frameRequestInFlight) return;

      frameRequestInFlight = true;
      const cycleStart = performance.now();
      const dimensions = captureDimensions();
      outputCanvas.width = dimensions.width;
      outputCanvas.height = dimensions.height;
      canvasCtx.drawImage(webcamVideo, 0, 0, dimensions.width, dimensions.height);

      try {
        const blob = await canvasToBlob(outputCanvas, 'image/jpeg', JPEG_QUALITY);
        if (!blob || !isStreaming || !sessionID) return;

        const now = performance.now();
        if (lastFrameTime > 0) {
          valFps.innerText = (1000 / (now - lastFrameTime)).toFixed(1);
        }
        lastFrameTime = now;

        const formData = new FormData();
        formData.append('file', blob, 'frame.jpg');
        const sendTime = performance.now();
        const endpoint = `/api/v1/sessions/${sessionID}/frame?after_sequence=${lastRenderedSequence}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          cache: 'no-store'
        });

        if (res.ok) {
          valLatency.innerText = `${Math.round(performance.now() - sendTime)}ms`;
          const data = await res.json();

          if (data.result_sequence && data.result_sequence > lastRenderedSequence) {
            lastRenderedSequence = data.result_sequence;
          }

          // Render only when the backend has a newer annotation. This avoids
          // repeatedly downloading/decoding the same base64 JPEG over tunnel.
          if (data.annotated_frame) {
            const img = new Image();
            img.onload = () => {
              if (isStreaming) canvasCtx.drawImage(img, 0, 0, outputCanvas.width, outputCanvas.height);
            };
            img.src = data.annotated_frame;
          }
          updateAnalyticsUI(data.analytics);
        }
      } catch (e) {
        // Ignore transient network frame drops; the next scheduled frame retries.
      } finally {
        frameRequestInFlight = false;
        if (isStreaming) {
          const elapsed = performance.now() - cycleStart;
          frameIntervalTimer = setTimeout(sendNextFrame, Math.max(0, FRAME_INTERVAL_MS - elapsed));
        }
      }
    };

    frameIntervalTimer = setTimeout(sendNextFrame, 0);
  }

  // Update UI Stats Cards, Ratio Bar & Realtime Chart
  function updateAnalyticsUI(stats) {
    if (!stats) return;

    const crowd = stats.crowd || {};
    const genderCounts = crowd.gender_counts || {};
    const crossing = stats.crossing || {};

    const total = crowd.current_count ?? 0;
    const male = genderCounts.male ?? 0;
    const female = genderCounts.female ?? 0;
    const checkIn = crossing.in ?? 0;
    const checkOut = crossing.out ?? 0;

    setAnimatedValue(valTotalCount, total);
    setAnimatedValue(valMaleCount, male);
    setAnimatedValue(valFemaleCount, female);
    setAnimatedValue(valCheckIn, checkIn);
    setAnimatedValue(valCheckOut, checkOut);

    // Push new values to Chart.js Flow Waveform
    updateChart(total, male, female);

    // Density Level Calculation based on crowd count
    if (total > 15) {
      valDensity.innerText = 'HIGH';
      valDensity.className = 'metric-value text-neon-pink digital-num';
    } else if (total > 5) {
      valDensity.innerText = 'MEDIUM';
      valDensity.className = 'metric-value text-neon-yellow digital-num';
    } else {
      valDensity.innerText = 'LOW';
      valDensity.className = 'metric-value text-neon-green digital-num';
    }

    // Gender Ratio Calculation
    const totalGender = male + female;
    if (totalGender > 0) {
      const malePct = Math.round((male / totalGender) * 100);
      const femalePct = 100 - malePct;
      barMale.style.width = `${malePct}%`;
      barFemale.style.width = `${femalePct}%`;
      valGenderRatioPct.innerText = `${malePct}% / ${femalePct}%`;
    }
  }

  // Handle Video File Upload
  function uploadAndProcessVideo(file) {
    if (!file) return;
    addLog(`Đang gửi Video File: ${file.name}...`, 'system');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', 'classroom_demo');

    fetch('/api/v1/video/analyze', {
      method: 'POST',
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      addLog(`Phân tích Video hoàn tất!`, 'system');
      updateAnalyticsUI(data.analytics);
    })
    .catch(err => {
      addLog(`Lỗi xử lý Video: ${err.message}`, 'error');
    });
  }

  // File Dropzone Event Listeners
  fileDropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) uploadAndProcessVideo(e.target.files[0]);
  });
});
