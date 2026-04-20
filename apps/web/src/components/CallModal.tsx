import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, Maximize, Minimize, SwitchCamera, Minimize2, Maximize2, Volume2, ShieldCheck, ShieldOff, ChevronUp } from 'lucide-react';
import { getSocket } from '../lib/socket';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { playCallRingtone, stopCallRingtone, playUnavailableSound } from '../lib/sounds';

type CallState = 'idle' | 'calling' | 'incoming' | 'connected' | 'ended';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: { id: string; displayName?: string; username: string; avatar?: string | null } | null;
  callType: 'voice' | 'video';
  incoming?: {
    from: string;
    offer: RTCSessionDescriptionInit;
    callType: 'voice' | 'video';
    callerInfo?: { displayName?: string; username?: string; avatar?: string | null } | null;
  } | null;
}

// ICE servers cache (fetched from server, includes TURN credentials when configured)
let cachedIceConfig: RTCConfiguration | null = null;
let iceCacheFetchedAt = 0;
const ICE_CACHE_TTL = 3600_000; // 1 hour

const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

async function getIceServers(): Promise<RTCConfiguration> {
  if (cachedIceConfig && Date.now() - iceCacheFetchedAt < ICE_CACHE_TTL) {
    return cachedIceConfig;
  }
  try {
    const data = await api.getIceServers();
    if (data.iceServers && data.iceServers.length > 0) {
      cachedIceConfig = { iceServers: data.iceServers };
      iceCacheFetchedAt = Date.now();
      return cachedIceConfig;
    }
  } catch (e) {
    console.warn('Failed to fetch ICE servers, using fallback STUN:', e);
  }
  return FALLBACK_ICE;
}

// Try to get video+audio, falling back to audio-only
// If preferDeviceId is given, try that camera first
async function getMediaWithCameraFallback(
  wantVideo: boolean,
  preferDeviceId?: string
): Promise<{ stream: MediaStream; hasVideo: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('mediaDevices недоступен. Используйте HTTPS соединение.');
  }

  if (!wantVideo) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    return { stream, hasVideo: false };
  }

  // 1) If we have a preferred camera, try it first
  if (preferDeviceId) {
    try {
      console.log('[getMedia] Trying preferred camera:', preferDeviceId.slice(0, 12));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { deviceId: { exact: preferDeviceId } },
      });
      console.log('[getMedia] Preferred camera success');
      return { stream, hasVideo: true };
    } catch (e) {
      console.warn('[getMedia] Preferred camera failed:', e);
    }
  }

  // 2) Try default audio+video
  try {
    console.log('[getMedia] Requesting audio+video (default camera)...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: true });
    console.log('[getMedia] Success —', stream.getVideoTracks().map(t => `${t.label}:${t.readyState}`));
    return { stream, hasVideo: true };
  } catch (e) {
    console.warn('[getMedia] audio+video failed:', e);
  }

  // 3) Final fallback: audio only
  console.warn('[getMedia] Camera unavailable, falling back to audio only');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return { stream, hasVideo: false };
}

// Find a video sender on the peer connection, even if sender.track is null (recvonly transceiver)
function findVideoSender(pc: RTCPeerConnection): RTCRtpSender | undefined {
  // First try sender with an active video track
  const withTrack = pc.getSenders().find(s => s.track?.kind === 'video');
  if (withTrack) return withTrack;
  // Fall back to sender from a video transceiver (may have null track)
  const videoTransceiver = pc.getTransceivers().find(
    t => t.receiver?.track?.kind === 'video'
  );
  return videoTransceiver?.sender;
}

export default function CallModal({ isOpen, onClose, targetUser, callType: initialCallType, incoming }: CallModalProps) {
  const { t } = useLang();
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'voice' | 'video'>(initialCallType);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [duration, setDuration] = useState(0);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [activeCameraId, setActiveCameraId] = useState<string>('');
  const [remoteVolume, setRemoteVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [activeMicId, setActiveMicId] = useState<string>('');
  const [showMicMenu, setShowMicMenu] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const targetUserIdRef = useRef<string>('');
  const iceCandidateBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const callEndedRef = useRef(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  // Track whether video was active before screen share to decide restoration behavior
  const hadVideoBeforeScreenShareRef = useRef(false);
  // Noise gate refs
  const noiseGateCtxRef = useRef<AudioContext | null>(null);
  const noiseGateGainRef = useRef<GainNode | null>(null);
  const noiseGateRafRef = useRef<number>(0);
  const noiseGateTrackRef = useRef<MediaStreamTrack | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    stopCallRingtone();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.ontrack = null;
      peerRef.current.close();
      peerRef.current = null;
    }
    iceCandidateBufferRef.current = [];
    remoteStreamRef.current = null;
    // Clean up noise gate
    if (noiseGateRafRef.current) cancelAnimationFrame(noiseGateRafRef.current);
    if (noiseGateTrackRef.current) { noiseGateTrackRef.current.stop(); noiseGateTrackRef.current = null; }
    if (noiseGateCtxRef.current) { noiseGateCtxRef.current.close().catch(() => {}); noiseGateCtxRef.current = null; }
    noiseGateGainRef.current = null;
    setDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setHasRemoteVideo(false);
    setIsFullscreen(false);
    setIsMinimized(false);
    setShowCameraMenu(false);
    setShowVolumeSlider(false);
    setShowMicMenu(false);
    setNoiseSuppression(false);
  }, []);

  // Setup common peer connection event handlers
  const setupPeerHandlers = useCallback((pc: RTCPeerConnection) => {
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const socket = getSocket();
        socket?.emit('ice_candidate', {
          targetUserId: targetUserIdRef.current,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      console.log('[ontrack] Received track:', e.track.kind, 'readyState:', e.track.readyState,
        'enabled:', e.track.enabled, 'streams:', e.streams.length,
        'muted:', e.track.muted);
      // Always merge new tracks into the existing remote stream to avoid losing
      // audio when a video-only screen share track arrives on a separate stream.
      let stream: MediaStream;
      if (remoteStreamRef.current) {
        if (!remoteStreamRef.current.getTracks().includes(e.track)) {
          remoteStreamRef.current.addTrack(e.track);
        }
        stream = remoteStreamRef.current;
      } else if (e.streams[0]) {
        stream = e.streams[0];
      } else {
        stream = new MediaStream([e.track]);
      }

      remoteStreamRef.current = stream;

      // Check if remote has video tracks
      // Include !t.muted so we detect when the remote stops sending
      // (replaceTrack(null) or direction change causes muted=true)
      const checkVideo = () => {
        const videoTracks = stream.getVideoTracks();
        const hasVideo = videoTracks.length > 0 && videoTracks.some(
          t => t.readyState === 'live' && t.enabled && !t.muted
        );
        console.log('[checkVideo] videoTracks:', videoTracks.map(t =>
          `${t.label} state=${t.readyState} enabled=${t.enabled} muted=${t.muted}`
        ), '→ hasRemoteVideo:', hasVideo);
        setHasRemoteVideo(hasVideo);
      };

      // Listen for unmute/mute on every video track (muted→unmuted when data starts flowing)
      const attachTrackListeners = (track: MediaStreamTrack) => {
        if (track.kind !== 'video') return;
        track.onunmute = checkVideo;
        track.onmute = checkVideo;
        track.onended = checkVideo;
      };

      stream.getVideoTracks().forEach(attachTrackListeners);
      checkVideo();

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => { });
      }

      // Track future additions/removals
      stream.onaddtrack = (ev) => {
        attachTrackListeners(ev.track);
        checkVideo();
      };
      stream.onremovetrack = checkVideo;

      // Also schedule a delayed check — some browsers delay unmute
      setTimeout(checkVideo, 500);
      setTimeout(checkVideo, 1500);
    };

    pc.onconnectionstatechange = () => {
      if (callEndedRef.current) return;
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        endCallSafe();
      }
    };
  }, []);

  // Schedule a tracked close timeout
  const scheduleClose = useCallback((delay = 1500) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      closeTimeoutRef.current = undefined;
      onClose();
    }, delay);
  }, [onClose]);

  // End call (safe to call multiple times)
  const endCallSafe = useCallback(() => {
    if (callEndedRef.current) return;
    callEndedRef.current = true;
    const socket = getSocket();
    socket?.emit('call_end', { targetUserId: targetUserIdRef.current });
    stopCallRingtone();
    setCallState('ended');
    cleanup();
    scheduleClose();
  }, [cleanup, scheduleClose]);

  // Start outgoing call
  const startCall = useCallback(async () => {
    if (!targetUser) return;
    targetUserIdRef.current = targetUser.id;
    callEndedRef.current = false;
    setCallState('calling');

    try {
      // Get media (video with camera enumeration fallback)
      console.log('[startCall] Getting media, wantVideo:', callType === 'video');
      const { stream, hasVideo } = await getMediaWithCameraFallback(callType === 'video');
      console.log('[startCall] Got media — hasVideo:', hasVideo,
        'audioTracks:', stream.getAudioTracks().length,
        'videoTracks:', stream.getVideoTracks().length);
      let effectiveCallType = callType;
      if (callType === 'video' && !hasVideo) {
        effectiveCallType = 'voice';
        setCallType('voice');
      }

      if (callEndedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      localStreamRef.current = stream;

      // Track active camera & mic
      const videoTrackSettings = stream.getVideoTracks()[0]?.getSettings();
      if (videoTrackSettings?.deviceId) setActiveCameraId(videoTrackSettings.deviceId);
      const audioTrackSettings = stream.getAudioTracks()[0]?.getSettings();
      if (audioTrackSettings?.deviceId) setActiveMicId(audioTrackSettings.deviceId);
      refreshCameras();
      refreshMicrophones();

      const iceConfig = await getIceServers();
      const pc = new RTCPeerConnection(iceConfig);
      peerRef.current = pc;

      // Add all tracks from the stream
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // If this is a video call but we only have audio, add a recvonly video transceiver
      // so we can receive video from the other side and potentially add video later
      if (effectiveCallType === 'video' && stream.getVideoTracks().length === 0) {
        pc.addTransceiver('video', { direction: 'recvonly' });
      }

      setupPeerHandlers(pc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const socket = getSocket();
      socket?.emit('call_offer', {
        targetUserId: targetUser.id,
        offer: pc.localDescription,
        callType: effectiveCallType,
      });

      // 15 second no-answer timeout
      callTimeoutRef.current = setTimeout(async () => {
        if (callEndedRef.current) return;
        callEndedRef.current = true;
        stopCallRingtone();
        const s = getSocket();
        s?.emit('call_end', { targetUserId: targetUserIdRef.current });
        cleanup();
        setCallState('ended');
        await playUnavailableSound();
        onClose();
      }, 15000);
    } catch (err: unknown) {
      console.error('Error starting call:', err);
      setCallState('ended');
      cleanup();
      
      // Show user-friendly error message
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : '';
      
      if (name === 'NotAllowedError' || message.includes('Permission') || message.includes('permission')) {
        alert(
          callType === 'video'
            ? '❌ Доступ к камере и микрофону запрещён.\n\nРазрешите доступ в настройках браузера:\n• Нажмите на значок замка/камеры в адресной строке\n• Выберите "Разрешить" для микрофона и камеры'
            : '❌ Доступ к микрофону запрещён.\n\nРазрешите доступ в настройках браузера:\n• Нажмите на значок замка/камеры в адресной строке\n• Выберите "Разрешить" для микрофона'
        );
      } else if (name === 'NotFoundError' || message.includes('NotFound') || message.includes('device')) {
        alert(
          callType === 'video'
            ? '❌ Камера или микрофон не найдены.\n\nПодключите устройства и попробуйте снова.'
            : '❌ Микрофон не найден.\n\nПодключите микрофон и попробуйте снова.'
        );
      } else if (name === 'NotReadableError' || message.includes('In use')) {
        alert('❌ Микрофон или камера уже используются другим приложением.\n\nЗакройте другие приложения, использующие микрофон/камеру.');
      } else {
        alert('❌ Не удалось начать звонок:\n' + (message || 'Неизвестная ошибка'));
      }
    }
  }, [targetUser, callType, cleanup, onClose, setupPeerHandlers]);

  // Accept incoming call
  const acceptCall = useCallback(async () => {
    if (!incoming) return;
    targetUserIdRef.current = incoming.from;
    callEndedRef.current = false;
    stopCallRingtone();

    try {
      console.log('[acceptCall] Getting media, wantVideo:', incoming.callType === 'video');
      const { stream, hasVideo } = await getMediaWithCameraFallback(incoming.callType === 'video');
      console.log('[acceptCall] Got media — hasVideo:', hasVideo,
        'audioTracks:', stream.getAudioTracks().length,
        'videoTracks:', stream.getVideoTracks().length,
        'videoEnabled:', stream.getVideoTracks().map(t => t.enabled));
      let effectiveCallType = incoming.callType;
      if (incoming.callType === 'video' && !hasVideo) {
        effectiveCallType = 'voice';
      }

      if (callEndedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      localStreamRef.current = stream;

      // Track active camera & mic
      const videoTrackSettings = stream.getVideoTracks()[0]?.getSettings();
      if (videoTrackSettings?.deviceId) setActiveCameraId(videoTrackSettings.deviceId);
      const audioTrackSettings = stream.getAudioTracks()[0]?.getSettings();
      if (audioTrackSettings?.deviceId) setActiveMicId(audioTrackSettings.deviceId);
      refreshCameras();
      refreshMicrophones();

      const iceConfig = await getIceServers();
      const pc = new RTCPeerConnection(iceConfig);
      peerRef.current = pc;

      // Setup handlers first so ontrack is ready when setRemoteDescription fires
      setupPeerHandlers(pc);

      // Standard answerer pattern: set remote description FIRST
      // This creates transceivers from the offer's m-lines
      await pc.setRemoteDescription(new RTCSessionDescription(incoming.offer));

      // Now add local tracks — they reuse the transceivers created from the offer,
      // changing direction from recvonly to sendrecv
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // If this is a video call but we only have audio, we need a recvonly video transceiver.
      // After setRemoteDescription, one already exists from the offer — but only if the offer
      // contained a video m-line. If it did, the transceiver is already recvonly.
      // If there's no video transceiver at all and we want to receive video, add one.
      if (incoming.callType === 'video' && !hasVideo) {
        const hasVideoTransceiver = pc.getTransceivers().some(
          t => t.receiver?.track?.kind === 'video'
        );
        if (!hasVideoTransceiver) {
          pc.addTransceiver('video', { direction: 'recvonly' });
        }
      }

      console.log('[acceptCall] Transceivers after setup:',
        pc.getTransceivers().map(t => ({
          mid: t.mid,
          direction: t.direction,
          senderTrack: t.sender?.track?.kind ?? null,
          receiverTrack: t.receiver?.track?.kind ?? null,
        })));

      if (callEndedRef.current) {
        pc.onconnectionstatechange = null;
        pc.close();
        peerRef.current = null;
        stream.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        return;
      }

      // Flush buffered ICE candidates
      for (const candidate of iceCandidateBufferRef.current) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
      iceCandidateBufferRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[acceptCall] Answer created, transceivers:',
        pc.getTransceivers().map(t => ({
          mid: t.mid,
          direction: t.direction,
          currentDirection: t.currentDirection,
          senderTrack: t.sender?.track?.kind ?? null,
        })));

      if (callEndedRef.current) {
        pc.onconnectionstatechange = null;
        pc.close();
        peerRef.current = null;
        stream.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        return;
      }

      const socket = getSocket();
      socket?.emit('call_answer', {
        targetUserId: incoming.from,
        answer: pc.localDescription,
      });

      setCallType(effectiveCallType);
      setCallState('connected');
      console.log('[acceptCall] Call connected, effectiveCallType:', effectiveCallType);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err: unknown) {
      console.error('Error accepting call:', err);
      if (!callEndedRef.current) {
        setCallState('ended');
        cleanup();
      }
      
      // Show user-friendly error message
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : '';
      
      if (name === 'NotAllowedError' || message.includes('Permission') || message.includes('permission')) {
        alert('❌ Доступ к микрофону запрещён.\n\nРазрешите доступ в настройках браузера:\n• Нажмите на значок замка/камеры в адресной строке\n• Выберите "Разрешить" для микрофона');
      } else if (name === 'NotFoundError' || message.includes('NotFound') || message.includes('device')) {
        alert('❌ Микрофон не найден.\n\nПодключите микрофон и попробуйте снова.');
      } else if (name === 'NotReadableError' || message.includes('In use')) {
        alert('❌ Микрофон уже используется другим приложением.\n\nЗакройте другие приложения, использующие микрофон.');
      } else {
        alert('❌ Не удалось принять звонок:\n' + (message || 'Неизвестная ошибка'));
      }
    }
  }, [incoming, cleanup, setupPeerHandlers]);

  // Decline incoming call
  const declineCall = useCallback(() => {
    if (incoming) {
      const socket = getSocket();
      socket?.emit('call_decline', { targetUserId: incoming.from });
    }
    callEndedRef.current = true;
    stopCallRingtone();
    setCallState('ended');
    cleanup();
    scheduleClose();
  }, [incoming, cleanup, scheduleClose]);

  // Toggle mic
  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Volume control for remote audio
  const handleVolumeChange = useCallback((vol: number) => {
    const v = Math.max(0, Math.min(1, vol));
    setRemoteVolume(v);
    if (remoteAudioRef.current) remoteAudioRef.current.volume = v;
  }, []);

  // Noise gate with look-ahead: analyse undelayed signal, gate delayed signal
  // This prevents clipping word beginnings and rejects short transients (clicks)
  const applyNoiseGate = useCallback(async () => {
    const pc = peerRef.current;
    if (!pc || !localStreamRef.current) return;
    const rawTrack = localStreamRef.current.getAudioTracks()[0];
    if (!rawTrack) return;

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));

      // Look-ahead delay: signal is delayed so gate can open before audio arrives
      const delayNode = ctx.createDelay(0.2);
      delayNode.delayTime.value = 0.05; // 50ms look-ahead

      // Analysis path: bandpass on voice fundamentals (undelayed, sees audio early)
      const analysisHP = ctx.createBiquadFilter();
      analysisHP.type = 'highpass'; analysisHP.frequency.value = 100; analysisHP.Q.value = 0.7;
      const analysisLP = ctx.createBiquadFilter();
      analysisLP.type = 'lowpass'; analysisLP.frequency.value = 4000; analysisLP.Q.value = 0.7;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      const dest = ctx.createMediaStreamDestination();

      // Signal path: source → delay → gain → output (full quality, just gated)
      source.connect(delayNode);
      delayNode.connect(gainNode);
      gainNode.connect(dest);

      // Analysis path (no delay): source → bandpass → analyser
      source.connect(analysisHP);
      analysisHP.connect(analysisLP);
      analysisLP.connect(analyser);

      const dataArray = new Float32Array(analyser.fftSize);
      const OPEN_THRESHOLD = -38;  // dB in voice band to trigger pending
      const CLOSE_THRESHOLD = -48; // dB hysteresis / transient rejection
      const CONFIRM_MS = 22;       // ms energy must persist to confirm voice (rejects clicks)
      const HOLD_TIME = 150;       // ms keep gate open after speech stops
      const ATTACK = 0.002;        // fast open (gate already decided ahead of time)
      const RELEASE = 0.02;        // smooth close

      // State machine: 0=closed, 1=pending (waiting to confirm voice), 2=open
      let state = 0;
      let pendingSince = 0;
      let holdUntil = 0;

      const check = () => {
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        const now = performance.now();

        if (state === 0) { // closed
          if (db > OPEN_THRESHOLD) {
            state = 1; // pending
            pendingSince = now;
          }
        } else if (state === 1) { // pending — wait to confirm sustained energy (voice) vs transient (click)
          if (db <= CLOSE_THRESHOLD) {
            state = 0; // energy dropped fast → was a click, stay closed
          } else if (now - pendingSince >= CONFIRM_MS) {
            state = 2; // sustained → voice confirmed, open gate
            holdUntil = now + HOLD_TIME;
            gainNode.gain.setTargetAtTime(1, ctx.currentTime, ATTACK);
          }
        } else { // open
          if (db > CLOSE_THRESHOLD) {
            holdUntil = now + HOLD_TIME;
          }
          if (now >= holdUntil) {
            state = 0;
            gainNode.gain.setTargetAtTime(0, ctx.currentTime, RELEASE);
          }
        }
        noiseGateRafRef.current = requestAnimationFrame(check);
      };
      check();

      const gatedTrack = dest.stream.getAudioTracks()[0];
      gatedTrack.enabled = !isMuted;

      // Replace in PeerConnection
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(gatedTrack);

      noiseGateCtxRef.current = ctx;
      noiseGateGainRef.current = gainNode;
      noiseGateTrackRef.current = gatedTrack;
      setNoiseSuppression(true);
    } catch (err) {
      console.error('Failed to apply noise gate:', err);
    }
  }, [isMuted]);

  const removeNoiseGate = useCallback(async () => {
    const pc = peerRef.current;
    // Restore raw mic track directly to PeerConnection
    if (pc && localStreamRef.current) {
      const rawTrack = localStreamRef.current.getAudioTracks()[0];
      if (rawTrack) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(rawTrack);
      }
    }
    if (noiseGateRafRef.current) { cancelAnimationFrame(noiseGateRafRef.current); noiseGateRafRef.current = 0; }
    if (noiseGateTrackRef.current) { noiseGateTrackRef.current.stop(); noiseGateTrackRef.current = null; }
    if (noiseGateCtxRef.current) { noiseGateCtxRef.current.close().catch(() => {}); noiseGateCtxRef.current = null; }
    noiseGateGainRef.current = null;
    setNoiseSuppression(false);
  }, []);

  const toggleNoiseSuppression = useCallback(async () => {
    if (noiseSuppression) {
      await removeNoiseGate();
    } else {
      await applyNoiseGate();
    }
  }, [noiseSuppression, applyNoiseGate, removeNoiseGate]);

  // Enumerate microphones
  const refreshMicrophones = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      setMicrophones(audioInputs);
      return audioInputs;
    } catch { return []; }
  }, []);

  // Switch microphone
  const switchMicrophone = useCallback(async (deviceId: string) => {
    const pc = peerRef.current;
    if (!pc) return;
    setShowMicMenu(false);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = !isMuted;

      // Remove noise gate if active (will re-apply after switch if needed)
      const wasGated = noiseSuppression;
      if (wasGated) await removeNoiseGate();

      // Replace in local stream
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => {
          localStreamRef.current!.removeTrack(t);
          t.stop();
        });
        localStreamRef.current.addTrack(newTrack);
      }
      // Replace in PeerConnection
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
      setActiveMicId(deviceId);

      // Re-apply noise gate if it was active
      if (wasGated) await applyNoiseGate();
    } catch (err) {
      console.error('Switch mic failed:', err);
    }
  }, [isMuted, noiseSuppression, removeNoiseGate, applyNoiseGate]);

  // Enumerate cameras
  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      setCameras(videoInputs);
      return videoInputs;
    } catch (e) {
      console.warn('Could not enumerate cameras:', e);
      return [];
    }
  }, []);

  // Open camera menu (await enumeration, then show)
  const openCameraMenu = useCallback(async () => {
    if (showCameraMenu) {
      setShowCameraMenu(false);
      return;
    }
    const cams = await refreshCameras();
    if (cams.length > 0) {
      setShowCameraMenu(true);
    }
  }, [showCameraMenu, refreshCameras]);

  // Switch to a specific camera by deviceId
  const switchCamera = useCallback(async (deviceId: string) => {
    const pc = peerRef.current;
    if (!pc) return;
    setShowCameraMenu(false);
    const prevCameraId = activeCameraId;

    try {
      // Strategy: try to acquire new camera FIRST without stopping the old one.
      // If that fails (some devices can't have 2 cameras open), stop old then retry.
      let newStream: MediaStream | null = null;

      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });
      } catch (e1) {
        console.warn('Could not open new camera while old is active, releasing old first:', e1);
        // Stop old camera tracks, then retry
        const currentSender = findVideoSender(pc);
        if (currentSender?.track) currentSender.track.stop();
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => {
            localStreamRef.current!.removeTrack(t);
            t.stop();
          });
        }
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });
      }

      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) {
        console.error('No video track from selected camera');
        return;
      }

      // Now stop old tracks (if they weren't stopped already in the fallback path above)
      const currentSender = findVideoSender(pc);
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => {
          if (t !== newTrack) {
            localStreamRef.current!.removeTrack(t);
            t.stop();
          }
        });
      }
      if (currentSender?.track && currentSender.track !== newTrack) {
        currentSender.track.stop();
      }

      // Replace track on sender or add new one
      if (currentSender) {
        await currentSender.replaceTrack(newTrack);
        // If direction was recvonly, change to sendrecv
        const transceiver = pc.getTransceivers().find(t => t.sender === currentSender);
        if (transceiver && (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive')) {
          transceiver.direction = 'sendrecv';
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          const socket = getSocket();
          socket?.emit('renegotiate', {
            targetUserId: targetUserIdRef.current,
            offer: pc.localDescription,
          });
        }
      } else {
        pc.addTrack(newTrack, localStreamRef.current || newStream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const socket = getSocket();
        socket?.emit('renegotiate', {
          targetUserId: targetUserIdRef.current,
          offer: pc.localDescription,
        });
      }

      // Update local stream
      if (localStreamRef.current) {
        localStreamRef.current.addTrack(newTrack);
      } else {
        localStreamRef.current = new MediaStream([newTrack]);
      }

      setActiveCameraId(deviceId);
      setIsVideoOff(false);
      setCallType('video');
    } catch (err) {
      console.error('Switch camera failed:', err);
      // Try to restore previous camera so video isn't permanently lost
      try {
        let restoreStream: MediaStream | undefined;
        // Try the exact previous camera first
        if (prevCameraId) {
          try {
            restoreStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: prevCameraId } },
            });
          } catch { /* previous camera also unavailable */ }
        }
        // Fall back to any camera
        if (!restoreStream) {
          try {
            restoreStream = await navigator.mediaDevices.getUserMedia({ video: true });
          } catch { /* no camera at all */ }
        }
        if (restoreStream) {
          const restoreTrack = restoreStream.getVideoTracks()[0];
          if (restoreTrack) {
            const sender = findVideoSender(pc);
            if (sender) {
              await sender.replaceTrack(restoreTrack);
              // Ensure direction allows sending + renegotiate
              const transceiver = pc.getTransceivers().find(t => t.sender === sender);
              if (transceiver && (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive')) {
                transceiver.direction = 'sendrecv';
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                const socket = getSocket();
                socket?.emit('renegotiate', {
                  targetUserId: targetUserIdRef.current,
                  offer: pc.localDescription,
                });
              }
            }
            if (localStreamRef.current) {
              localStreamRef.current.addTrack(restoreTrack);
            } else {
              localStreamRef.current = restoreStream;
            }
            setIsVideoOff(false);
          }
        }
      } catch { /* nothing we can do */ }
    }
  }, [activeCameraId]);

  // Toggle video: enable/disable video track, or get camera if none
  const toggleVideo = useCallback(async () => {
    const pc = peerRef.current;
    if (!pc) return;

    if (!isVideoOff) {
      // Turn off: disable video track on sender and revert to voice
      const sender = findVideoSender(pc);
      if (sender?.track) {
        sender.track.enabled = false;
      }
      setIsVideoOff(true);
      setCallType('voice');
    } else {
      // Turn on: re-enable existing track or get new camera
      const sender = findVideoSender(pc);
      if (sender?.track) {
        sender.track.enabled = true;
        setIsVideoOff(false);
      } else {
        try {
          const { stream: camStream, hasVideo } = await getMediaWithCameraFallback(true);
          if (!hasVideo) {
            console.warn('No camera available');
            return;
          }
          const videoTrack = camStream.getVideoTracks()[0];

          // Find a video sender (may have null track from transceiver)
          const existingSender = findVideoSender(pc);
          if (existingSender) {
            await existingSender.replaceTrack(videoTrack);
            // If direction was recvonly, change to sendrecv and renegotiate
            const transceiver = pc.getTransceivers().find(t => t.sender === existingSender);
            if (transceiver && (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive')) {
              transceiver.direction = 'sendrecv';
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const socket = getSocket();
              socket?.emit('renegotiate', {
                targetUserId: targetUserIdRef.current,
                offer: pc.localDescription,
              });
            }
          } else {
            pc.addTrack(videoTrack, localStreamRef.current || camStream);
            // Renegotiate since new track added
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const socket = getSocket();
            socket?.emit('renegotiate', {
              targetUserId: targetUserIdRef.current,
              offer: pc.localDescription,
            });
          }

          if (localStreamRef.current) {
            localStreamRef.current.addTrack(videoTrack);
          }

          setIsVideoOff(false);
          setCallType('video');
        } catch (err) {
          console.error('Could not start camera:', err);
        }
      }
    }
  }, [isVideoOff]);

  // Screen sharing
  const toggleScreenShare = useCallback(async () => {
    const pc = peerRef.current;
    if (!pc) return;

    if (isScreenSharing) {
      // Stop screen share
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }

      const hadVideo = hadVideoBeforeScreenShareRef.current;

      if (hadVideo) {
        // Restore camera — request video only (no audio) to avoid interfering with existing mic
        let cameraRestored = false;
        try {
          const constraints: MediaStreamConstraints = activeCameraId
            ? { video: { deviceId: { exact: activeCameraId } } }
            : { video: true };
          const camStream = await navigator.mediaDevices.getUserMedia(constraints);
          const cameraTrack = camStream.getVideoTracks()[0];
          if (cameraTrack) {
            const sender = findVideoSender(pc);
            if (sender) {
              await sender.replaceTrack(cameraTrack);
            }
            if (localStreamRef.current) {
              localStreamRef.current.getVideoTracks().forEach(t => {
                localStreamRef.current!.removeTrack(t);
                t.stop();
              });
              localStreamRef.current.addTrack(cameraTrack);
            }
            cameraRestored = true;
          }
        } catch (err) {
          console.error('Error restoring camera:', err);
        }
        if (!cameraRestored) {
          // Null out sender and go recvonly
          const sender = findVideoSender(pc);
          if (sender) {
            await sender.replaceTrack(null);
            const transceiver = pc.getTransceivers().find(t => t.sender === sender);
            if (transceiver && transceiver.direction !== 'recvonly') {
              transceiver.direction = 'recvonly';
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                const socket = getSocket();
                socket?.emit('renegotiate', {
                  targetUserId: targetUserIdRef.current,
                  offer: pc.localDescription,
                });
              } catch (e) { console.error('Renegotiation after screen share stop failed:', e); }
            }
          }
          if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach(t => {
              localStreamRef.current!.removeTrack(t);
              t.stop();
            });
          }
          setIsVideoOff(true);
        }
      } else {
        // Was voice call — don't restore camera, just null out the video sender
        const sender = findVideoSender(pc);
        if (sender) {
          await sender.replaceTrack(null);
          const transceiver = pc.getTransceivers().find(t => t.sender === sender);
          if (transceiver && transceiver.direction !== 'recvonly') {
            transceiver.direction = 'recvonly';
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              const socket = getSocket();
              socket?.emit('renegotiate', {
                targetUserId: targetUserIdRef.current,
                offer: pc.localDescription,
              });
            } catch (e) { console.error('Renegotiation after screen share stop failed:', e); }
          }
        }
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => {
            localStreamRef.current!.removeTrack(t);
            t.stop();
          });
        }
        setCallType('voice');
        setIsVideoOff(false);
      }

      setIsScreenSharing(false);
    } else {
      // Start screen share — remember current video state
      hadVideoBeforeScreenShareRef.current = callType === 'video' && !isVideoOff;
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        // Find video sender and replace track
        const sender = findVideoSender(pc);
        if (sender) {
          await sender.replaceTrack(screenTrack);
          const transceiver = pc.getTransceivers().find(t => t.sender === sender);
          if (transceiver && (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive')) {
            transceiver.direction = 'sendrecv';
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const socket = getSocket();
            socket?.emit('renegotiate', {
              targetUserId: targetUserIdRef.current,
              offer: pc.localDescription,
            });
          }
        } else {
          // No video sender — add track associated with localStream to keep audio on same stream
          pc.addTrack(screenTrack, localStreamRef.current || screenStream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          const socket = getSocket();
          socket?.emit('renegotiate', {
            targetUserId: targetUserIdRef.current,
            offer: pc.localDescription,
          });
        }

        screenTrack.onended = async () => {
          setIsScreenSharing(false);
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
          }

          const hadVideo = hadVideoBeforeScreenShareRef.current;
          const snd = peerRef.current ? findVideoSender(peerRef.current) : undefined;

          if (hadVideo) {
            // Restore camera — video only, no audio
            let cameraRestored = false;
            try {
              const constraints: MediaStreamConstraints = activeCameraId
                ? { video: { deviceId: { exact: activeCameraId } } }
                : { video: true };
              const camStream = await navigator.mediaDevices.getUserMedia(constraints);
              const camTrack = camStream.getVideoTracks()[0];
              if (camTrack) {
                if (snd) await snd.replaceTrack(camTrack);
                if (localStreamRef.current) {
                  localStreamRef.current.getVideoTracks().forEach(t => {
                    localStreamRef.current!.removeTrack(t);
                    t.stop();
                  });
                  localStreamRef.current.addTrack(camTrack);
                }
                cameraRestored = true;
              }
            } catch (e) {
              console.error('Error restoring camera:', e);
            }
            if (!cameraRestored && snd) {
              await snd.replaceTrack(null);
              const currentPc = peerRef.current;
              if (currentPc) {
                const transceiver = currentPc.getTransceivers().find(t => t.sender === snd);
                if (transceiver && transceiver.direction !== 'recvonly') {
                  transceiver.direction = 'recvonly';
                  try {
                    const offer = await currentPc.createOffer();
                    await currentPc.setLocalDescription(offer);
                    const socket = getSocket();
                    socket?.emit('renegotiate', {
                      targetUserId: targetUserIdRef.current,
                      offer: currentPc.localDescription,
                    });
                  } catch (e) { console.error('Renegotiation after screen share onended failed:', e); }
                }
              }
              if (localStreamRef.current) {
                localStreamRef.current.getVideoTracks().forEach(t => {
                  localStreamRef.current!.removeTrack(t);
                  t.stop();
                });
              }
            }
          } else {
            // Was voice call — just null out video sender
            if (snd) {
              await snd.replaceTrack(null);
              const currentPc = peerRef.current;
              if (currentPc) {
                const transceiver = currentPc.getTransceivers().find(t => t.sender === snd);
                if (transceiver && transceiver.direction !== 'recvonly') {
                  transceiver.direction = 'recvonly';
                  try {
                    const offer = await currentPc.createOffer();
                    await currentPc.setLocalDescription(offer);
                    const socket = getSocket();
                    socket?.emit('renegotiate', {
                      targetUserId: targetUserIdRef.current,
                      offer: currentPc.localDescription,
                    });
                  } catch (e) { console.error('Renegotiation after screen share onended failed:', e); }
                }
              }
            }
            if (localStreamRef.current) {
              localStreamRef.current.getVideoTracks().forEach(t => {
                localStreamRef.current!.removeTrack(t);
                t.stop();
              });
            }
            setCallType('voice');
          }
        };

        setIsScreenSharing(true);
        setCallType('video');
      } catch (err) {
        console.error('Error starting screen share:', err);
      }
    }
  }, [isScreenSharing, activeCameraId, callType, isVideoOff]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    if (!videoContainerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await videoContainerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      console.error('Fullscreen error:', e);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Socket event listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onCallAnswered = async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      if (!peerRef.current || data.from !== targetUserIdRef.current) return;
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      stopCallRingtone();
      console.log('[onCallAnswered] Setting remote description (answer)');
      await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      console.log('[onCallAnswered] Transceivers after answer:',
        peerRef.current.getTransceivers().map(t => ({
          mid: t.mid,
          direction: t.direction,
          currentDirection: t.currentDirection,
          senderTrack: t.sender?.track?.kind ?? null,
          receiverTrack: t.receiver?.track?.kind ?? null,
        })));
      for (const candidate of iceCandidateBufferRef.current) {
        peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
      iceCandidateBufferRef.current = [];
      setCallState('connected');
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    };

    const onIceCandidate = (data: { from: string; candidate: RTCIceCandidateInit }) => {
      if (peerRef.current && peerRef.current.remoteDescription) {
        peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
      } else {
        iceCandidateBufferRef.current.push(data.candidate);
      }
    };

    const onCallEnded = (data: { from: string }) => {
      if (callEndedRef.current) return;
      if (data.from !== targetUserIdRef.current) return;
      callEndedRef.current = true;
      stopCallRingtone();
      setCallState('ended');
      cleanup();
      scheduleClose();
    };

    const onCallDeclined = (data: { from: string }) => {
      if (callEndedRef.current) return;
      if (data.from !== targetUserIdRef.current) return;
      callEndedRef.current = true;
      stopCallRingtone();
      setCallState('ended');
      cleanup();
      scheduleClose();
    };

    const onCallUnavailable = () => {
      if (callEndedRef.current) return;
      callEndedRef.current = true;
      stopCallRingtone();
      setCallState('ended');
      cleanup();
      scheduleClose();
    };

    // Renegotiation (e.g. when remote adds screen share to audio-only call)
    const onRenegotiate = async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
      if (!peerRef.current || data.from !== targetUserIdRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerRef.current.createAnswer();
        await peerRef.current.setLocalDescription(answer);
        socket.emit('renegotiate_answer', {
          targetUserId: targetUserIdRef.current,
          answer: peerRef.current.localDescription,
        });
      } catch (err) {
        console.error('Renegotiation error:', err);
      }
    };

    const onRenegotiateAnswer = async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      if (!peerRef.current || data.from !== targetUserIdRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        console.error('Renegotiation answer error:', err);
      }
    };

    socket.on('call_answered', onCallAnswered);
    socket.on('ice_candidate', onIceCandidate);
    socket.on('call_ended', onCallEnded);
    socket.on('call_declined', onCallDeclined);
    socket.on('call_unavailable', onCallUnavailable);
    socket.on('renegotiate', onRenegotiate);
    socket.on('renegotiate_answer', onRenegotiateAnswer);

    return () => {
      socket.off('call_answered', onCallAnswered);
      socket.off('ice_candidate', onIceCandidate);
      socket.off('call_ended', onCallEnded);
      socket.off('call_declined', onCallDeclined);
      socket.off('call_unavailable', onCallUnavailable);
      socket.off('renegotiate', onRenegotiate);
      socket.off('renegotiate_answer', onRenegotiateAnswer);
    };
  }, [cleanup, scheduleClose]);

  // Start call on mount (outgoing)
  useEffect(() => {
    if (isOpen && !incoming && targetUser && callState === 'idle') {
      startCall();
    }
    if (isOpen && incoming && callState === 'idle') {
      targetUserIdRef.current = incoming.from;
      setCallState('incoming');
      setCallType(incoming.callType);
      playCallRingtone();
    }
  }, [isOpen, incoming, targetUser, callState, startCall]);

  // Sync local video ref with stream (only when srcObject actually changes)
  useEffect(() => {
    if (!localVideoRef.current) return;
    const desired = isScreenSharing && screenStreamRef.current
      ? screenStreamRef.current
      : localStreamRef.current;
    if (desired && localVideoRef.current.srcObject !== desired) {
      localVideoRef.current.srcObject = desired;
    }
  });

  // Sync remote video ref with remote stream (only when srcObject actually changes)
  useEffect(() => {
    if (!remoteVideoRef.current) return;
    if (remoteStreamRef.current && remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCallRingtone();
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      cleanup();
    };
  }, [cleanup]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const displayName = incoming
    ? incoming.callerInfo?.displayName || incoming.callerInfo?.username || '...'
    : targetUser?.displayName || targetUser?.username || '...';

  const displayAvatar = incoming
    ? incoming.callerInfo?.avatar
    : targetUser?.avatar;

  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (!isOpen) return null;

  const showVideoArea = callState === 'connected' && (hasRemoteVideo || (callType === 'video' && (!isVideoOff || isScreenSharing)));
  const hasLocalVideo = !!(
    localStreamRef.current?.getVideoTracks().some(t => t.enabled) || isScreenSharing
  );

  return (
    <AnimatePresence>
      <audio key="remote-audio" ref={remoteAudioRef} autoPlay playsInline />

      {/* === MINIMIZED VIEW === */}
      {isMinimized && callState === 'connected' ? (
        <motion.div
          key="call-minimized"
          initial={{ opacity: 0, y: 50, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.8 }}
          className="fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-2xl glass-strong shadow-2xl shadow-black/50 border border-white/10 cursor-pointer select-none"
          onClick={() => setIsMinimized(false)}
        >
          {/* Avatar */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-vortex-500/30 animate-call-wave" />
            {displayAvatar ? (
              <img src={displayAvatar} alt="" className="relative w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                {initials}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white font-medium truncate max-w-[120px]">{displayName}</p>
            <p className="text-xs text-zinc-400 font-mono">{formatDuration(duration)}</p>
          </div>
          {/* Quick controls */}
          <div className="flex items-center gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={toggleMic}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button
              onClick={endCallSafe}
              className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
            >
              <PhoneOff size={14} />
            </button>
          </div>
          {/* Hidden remote video to keep stream alive */}
          <video ref={remoteVideoRef} autoPlay playsInline muted className="hidden" />
          <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />
        </motion.div>
      ) : (

      /* === FULL VIEW === */
      <motion.div
        key="call-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Call"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-surface/90 backdrop-blur-xl overflow-hidden"
        onClick={() => { setShowCameraMenu(false); setShowVolumeSlider(false); setShowMicMenu(false); }}
      >
        {/* Ambient background glow for call modal */}
        <div className="absolute inset-0 pointer-events-none opacity-40">
          <div className="absolute top-[10%] left-[20%] w-[50vh] h-[50vh] bg-vortex-500/30 rounded-full blur-[120px] animate-float" />
          <div className="absolute bottom-[10%] right-[20%] w-[50vh] h-[50vh] bg-emerald-500/20 rounded-full blur-[120px] animate-float-delayed" />
        </div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`relative w-full mx-4 rounded-[2.5rem] glass-strong shadow-2xl shadow-black/50 overflow-hidden border border-white/5 ${showVideoArea ? 'max-w-5xl' : 'max-w-md'
            }`}
        >
          {/* Mic selector popup */}
          {showMicMenu && microphones.length > 0 && (
            <>
              <div className="fixed inset-0 z-[200]" onClick={() => setShowMicMenu(false)} />
              <div className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] rounded-xl bg-zinc-800/95 backdrop-blur-md border border-zinc-600 shadow-2xl py-2">
                <div className="px-3 py-1.5 text-xs text-zinc-400 uppercase tracking-wider border-b border-zinc-700 mb-1">{t('selectMicrophone')}</div>
                {microphones.map((mic, i) => (
                  <button
                    key={mic.deviceId}
                    onClick={() => switchMicrophone(mic.deviceId)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${activeMicId === mic.deviceId
                        ? 'text-vortex-400 bg-vortex-500/20 font-medium'
                        : 'text-zinc-200 hover:bg-zinc-700'
                      }`}
                  >
                    {mic.label || `${t('microphone')} ${i + 1}`}
                  </button>
                ))}
              </div>
            </>
          )}
          {/* Camera selector popup - rendered outside overflow-hidden container */}
          {showCameraMenu && cameras.length > 0 && (
            <>
              {/* Backdrop to close on click outside */}
              <div className="fixed inset-0 z-[200]" onClick={() => setShowCameraMenu(false)} />
              <div className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] rounded-xl bg-zinc-800/95 backdrop-blur-md border border-zinc-600 shadow-2xl py-2">
                <div className="px-3 py-1.5 text-xs text-zinc-400 uppercase tracking-wider border-b border-zinc-700 mb-1">{t('switchCamera')}</div>
                {cameras.map((cam, i) => (
                  <button
                    key={cam.deviceId}
                    onClick={() => switchCamera(cam.deviceId)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${activeCameraId === cam.deviceId
                        ? 'text-vortex-400 bg-vortex-500/20 font-medium'
                        : 'text-zinc-200 hover:bg-zinc-700'
                      }`}
                  >
                    {cam.label || `Camera ${i + 1}`}
                  </button>
                ))}
              </div>
            </>
          )}
          {/* Volume slider popup */}
          {showVolumeSlider && (
            <>
              <div className="fixed inset-0 z-[200]" onClick={() => setShowVolumeSlider(false)} />
              <div className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] rounded-xl bg-zinc-800/95 backdrop-blur-md border border-zinc-600 shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs text-zinc-400 uppercase tracking-wider mb-3">{t('volume')}</div>
                <div className="flex items-center gap-3">
                  <Volume2 size={16} className="text-zinc-400 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={remoteVolume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-600 accent-vortex-500 cursor-pointer"
                  />
                  <span className="text-xs text-zinc-300 w-8 text-right">{Math.round(remoteVolume * 100)}%</span>
                </div>
              </div>
            </>
          )}
          {/* === Video layout (connected, has video) === */}
          {showVideoArea ? (
            <div
              ref={videoContainerRef}
              className="relative bg-black w-full"
              style={{ aspectRatio: '16 / 9' }}
            >
              {/* Remote video — fills container, preserves natural aspect ratio */}
              {hasRemoteVideo ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                  onContextMenu={(e) => { e.preventDefault(); setShowVolumeSlider(true); }}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <VideoOff size={48} className="text-zinc-500 mb-2" />
                  <span className="text-sm text-zinc-500">{displayName}</span>
                  {/* Hidden video to keep stream alive */}
                  <video ref={remoteVideoRef} autoPlay playsInline muted className="hidden" />
                </div>
              )}

              {/* Local video PIP (bottom-right) */}
              {hasLocalVideo && (
                <div className="absolute bottom-3 right-3 w-48 rounded-xl overflow-hidden border-2 border-white/20 shadow-lg bg-black z-10"
                  style={{ aspectRatio: '16 / 9' }}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain bg-black"
                  />
                </div>
              )}

              {/* Duration badge */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-black/50 backdrop-blur-sm z-10">
                <span className="text-sm text-white font-mono">{formatDuration(duration)}</span>
              </div>

              {/* Top-right buttons: minimize + fullscreen */}
              <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                <button
                  onClick={() => setIsMinimized(true)}
                  className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title={t('minimize')}
                >
                  <Minimize2 size={16} />
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white transition-colors"
                >
                  {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>
            </div>
          ) : (
            /* === Voice / calling / incoming layout === */
            <div className="px-8 py-12 flex flex-col items-center relative z-10">
              {/* Minimize button (top-right) */}
              {callState === 'connected' && (
                <button
                  onClick={() => setIsMinimized(true)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title={t('minimize')}
                >
                  <Minimize2 size={16} />
                </button>
              )}
              {/* Avatar with pulse — right-click for volume */}
              <div
                className="relative mb-8 mt-4"
                onContextMenu={(e) => {
                  if (callState === 'connected') {
                    e.preventDefault();
                    setShowVolumeSlider(true);
                  }
                }}
                title={callState === 'connected' ? t('rightClickVolume') : undefined}
              >
                {(callState === 'calling' || callState === 'connected') && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-vortex-500/30 animate-call-wave" />
                    <div className="absolute inset-0 rounded-full bg-vortex-500/20 animate-call-wave-delayed" />
                  </>
                )}
                {callState === 'incoming' && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-emerald-500/30 animate-call-wave" />
                    <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-call-wave-delayed" />
                  </>
                )}
                <div className="relative z-10 p-1.5 rounded-full bg-gradient-to-br from-white/10 to-transparent backdrop-blur-md border border-white/10 shadow-2xl cursor-pointer">
                  {displayAvatar ? (
                    <img src={displayAvatar} alt="" className="w-32 h-32 rounded-full object-cover shadow-inner" />
                  ) : (
                    <div className="w-32 h-32 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white font-bold text-4xl shadow-inner">
                      {initials}
                    </div>
                  )}
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">{displayName}</h3>
              <p className="text-sm text-zinc-400 mb-8">
                {callState === 'calling' && t('calling')}
                {callState === 'incoming' && (callType === 'video' ? t('incomingVideoCall') : t('incomingCall'))}
                {callState === 'connected' && formatDuration(duration)}
                {callState === 'ended' && t('callEnded')}
              </p>

              {/* Local video preview (during calling with camera) */}
              {hasLocalVideo && callState === 'calling' && (
                <div className="mb-6 rounded-2xl overflow-hidden bg-zinc-900 w-48">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-auto"
                  />
                </div>
              )}

              {/* Hidden remote video element */}
              <video ref={remoteVideoRef} autoPlay playsInline muted className="hidden" />
            </div>
          )}

          {/* === Controls === */}
          <div className="px-8 pb-10 flex items-center justify-center gap-4 relative z-10 flex-wrap">
            {callState === 'incoming' && (
              <>
                <button
                  onClick={declineCall}
                  className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl shadow-red-500/30 transition-all hover:scale-105"
                >
                  <PhoneOff size={24} />
                </button>
                <div className="w-8" />
                <button
                  onClick={acceptCall}
                  className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-white shadow-xl shadow-emerald-500/30 transition-all hover:scale-105 animate-pulse"
                >
                  {callType === 'video' ? <Video size={24} /> : <Phone size={24} className="animate-bounce" />}
                </button>
              </>
            )}

            {callState === 'connected' && (
              <>
                {/* Mic button with dropdown */}
                <div className="relative">
                  <button
                    onClick={toggleMic}
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    title={isMuted ? t('unmute') : t('mute')}
                  >
                    {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button
                    onClick={async (e) => { e.stopPropagation(); await refreshMicrophones(); setShowMicMenu(!showMicMenu); setShowCameraMenu(false); setShowVolumeSlider(false); }}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-white/70 hover:text-white transition-colors border border-zinc-600"
                  >
                    <ChevronUp size={10} />
                  </button>
                </div>
                {/* Camera toggle — only for video calls */}
                {initialCallType === 'video' && (
                  <button
                    onClick={toggleVideo}
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                  >
                    {isVideoOff ? <VideoOff size={18} /> : <Video size={18} />}
                  </button>
                )}
                {/* Camera selector — only for video calls */}
                {initialCallType === 'video' && (
                  <button
                    onClick={openCameraMenu}
                    className="w-11 h-11 rounded-full flex items-center justify-center transition-colors bg-white/10 text-white hover:bg-white/20"
                    title={t('switchCamera')}
                  >
                    <SwitchCamera size={18} />
                  </button>
                )}
                <button
                  onClick={toggleScreenShare}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-vortex-500/30 text-vortex-400' : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  title={isScreenSharing ? t('stopScreenShare') : t('screenShare')}
                >
                  {isScreenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
                </button>
                {/* Volume control */}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowVolumeSlider(!showVolumeSlider); }}
                  className="w-11 h-11 rounded-full flex items-center justify-center transition-colors bg-white/10 text-white hover:bg-white/20"
                  title={t('volume')}
                >
                  <Volume2 size={18} />
                </button>
                {/* Noise suppression */}
                <button
                  onClick={toggleNoiseSuppression}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${noiseSuppression ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  title={noiseSuppression ? t('noiseSuppressionOn') : t('noiseSuppressionOff')}
                >
                  {noiseSuppression ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
                </button>
                <button
                  onClick={endCallSafe}
                  className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl shadow-red-500/30 transition-all hover:scale-105 ml-2"
                >
                  <PhoneOff size={22} />
                </button>
              </>
            )}

            {callState === 'calling' && (
              <button
                onClick={endCallSafe}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl shadow-red-500/30 transition-all hover:scale-105"
              >
                <PhoneOff size={24} />
              </button>
            )}

            {callState === 'ended' && (
              <p className="text-sm text-zinc-500">{t('callEnded')}</p>
            )}
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
