import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, Minimize2, Volume2, ShieldCheck, ShieldOff, ChevronUp } from 'lucide-react';
import { getSocket } from '../lib/socket';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';

interface ParticipantInfo {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string | null;
}

interface PeerState {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  hasVideo: boolean;
}

interface GroupCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  chatName: string;
  callType: 'voice' | 'video';
}

// ICE config reuse
let cachedIceConfig: RTCConfiguration | null = null;
let iceCacheFetchedAt = 0;
const ICE_CACHE_TTL = 3600_000;
const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

async function getIceServers(): Promise<RTCConfiguration> {
  if (cachedIceConfig && Date.now() - iceCacheFetchedAt < ICE_CACHE_TTL) return cachedIceConfig;
  try {
    const data = await api.getIceServers();
    if (data.iceServers?.length > 0) {
      cachedIceConfig = { iceServers: data.iceServers };
      iceCacheFetchedAt = Date.now();
      return cachedIceConfig;
    }
  } catch { /* fallback */ }
  return FALLBACK_ICE;
}

export default function GroupCallModal({ isOpen, onClose, chatId, chatName, callType: initialCallType }: GroupCallModalProps) {
  const { t } = useLang();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(initialCallType === 'voice');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [duration, setDuration] = useState(0);
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [remoteVolume, setRemoteVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(false);
  const [joined, setJoined] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [activeMicId, setActiveMicId] = useState<string>('');
  const [showMicMenu, setShowMicMenu] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const joinedRef = useRef(false);
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  // Force re-render when peer video state changes
  const [, forceUpdate] = useState(0);
  // Noise gate refs
  const noiseGateCtxRef = useRef<AudioContext | null>(null);
  const noiseGateGainRef = useRef<GainNode | null>(null);
  const noiseGateRafRef = useRef<number>(0);
  const noiseGateTrackRef = useRef<MediaStreamTrack | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    for (const [, peer] of peersRef.current) {
      peer.pc.close();
    }
    peersRef.current.clear();
    remoteAudioRefs.current.clear();
    // Clean up noise gate
    if (noiseGateRafRef.current) cancelAnimationFrame(noiseGateRafRef.current);
    if (noiseGateTrackRef.current) { noiseGateTrackRef.current.stop(); noiseGateTrackRef.current = null; }
    if (noiseGateCtxRef.current) { noiseGateCtxRef.current.close().catch(() => {}); noiseGateCtxRef.current = null; }
    noiseGateGainRef.current = null;
    setParticipants(new Map());
    setDuration(0);
    setIsMuted(false);
    setIsVideoOff(initialCallType === 'voice');
    setIsScreenSharing(false);
    setIsMinimized(false);
    setJoined(false);
    joinedRef.current = false;
    setNoiseSuppression(false);
    setShowMicMenu(false);
  }, [initialCallType]);

  const createPeerConnection = useCallback(async (targetUserId: string, initiator: boolean) => {
    const iceConfig = await getIceServers();
    const pc = new RTCPeerConnection(iceConfig);
    const remoteStream = new MediaStream();

    const peerState: PeerState = { pc, remoteStream, hasVideo: false };
    peersRef.current.set(targetUserId, peerState);

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const socket = getSocket();
        socket?.emit('group_ice_candidate', { chatId, targetUserId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (!remoteStream.getTracks().includes(e.track)) {
        remoteStream.addTrack(e.track);
      }
      const hasVid = remoteStream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);
      peerState.hasVideo = hasVid;

      e.track.onunmute = () => {
        peerState.hasVideo = remoteStream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);
        forceUpdate(n => n + 1);
      };
      e.track.onmute = () => {
        peerState.hasVideo = remoteStream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled && !t.muted);
        forceUpdate(n => n + 1);
      };

      // Play audio through audio element
      const audioEl = remoteAudioRefs.current.get(targetUserId);
      if (audioEl && audioEl.srcObject !== remoteStream) {
        audioEl.srcObject = remoteStream;
        audioEl.volume = remoteVolume;
        audioEl.play().catch(() => {});
      }

      forceUpdate(n => n + 1);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[GroupCall] Peer ${targetUserId} connection ${pc.connectionState}`);
      }
    };

    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const socket = getSocket();
      socket?.emit('group_call_offer', { chatId, targetUserId, offer: pc.localDescription });
    }

    return peerState;
  }, [chatId, remoteVolume]);

  const joinCall = useCallback(async () => {
    if (joinedRef.current) return;
    joinedRef.current = true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Звонки не поддерживаются в вашем браузере.\n\nИспользуйте HTTPS соединение.');
        joinedRef.current = false;
        return;
      }

      const wantVideo = initialCallType === 'video';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
        video: wantVideo,
      }).catch(async () => {
        // Fallback to audio only
        return navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } });
      });

      localStreamRef.current = stream;
      if (!stream.getVideoTracks().length) setIsVideoOff(true);

      const audioSettings = stream.getAudioTracks()[0]?.getSettings();
      if (audioSettings?.deviceId) setActiveMicId(audioSettings.deviceId);
      refreshMicrophones();

      const socket = getSocket();
      socket?.emit('group_call_join', { chatId, callType: initialCallType });
      setJoined(true);

      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err: unknown) {
      console.error('Error joining group call:', err);
      joinedRef.current = false;
      
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
        alert('❌ Не удалось войти в звонок:\n' + (message || 'Неизвестная ошибка'));
      }
    }
  }, [chatId, initialCallType, t]);

  const leaveCall = useCallback(() => {
    const socket = getSocket();
    socket?.emit('group_call_leave', { chatId });
    cleanup();
    onClose();
  }, [chatId, cleanup, onClose]);

  // Toggle mic
  const toggleMic = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(m => !m);
    }
  }, []);

  // Toggle video
  const toggleVideo = useCallback(async () => {
    if (!isVideoOff) {
      // Turn off video
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = false; });
      }
      setIsVideoOff(true);
    } else {
      // Turn on video
      if (localStreamRef.current?.getVideoTracks().some(t => t.readyState === 'live')) {
        localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = true; });
        setIsVideoOff(false);
      } else {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const videoTrack = camStream.getVideoTracks()[0];
          if (videoTrack && localStreamRef.current) {
            localStreamRef.current.addTrack(videoTrack);
            // Add to all peer connections
            for (const [, peer] of peersRef.current) {
              peer.pc.addTrack(videoTrack, localStreamRef.current);
              const offer = await peer.pc.createOffer();
              await peer.pc.setLocalDescription(offer);
            }
            setIsVideoOff(false);
          }
        } catch { console.warn('Camera unavailable'); }
      }
    }
  }, [isVideoOff]);

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      // Replace screen track with null on all peers
      for (const [targetUserId, peer] of peersRef.current) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(null);
          const transceiver = peer.pc.getTransceivers().find(t => t.sender === sender);
          if (transceiver) transceiver.direction = 'recvonly';
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          const socket = getSocket();
          socket?.emit('group_call_renegotiate', { chatId, targetUserId, offer: peer.pc.localDescription });
        }
      }
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        for (const [targetUserId, peer] of peersRef.current) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(screenTrack);
            const transceiver = peer.pc.getTransceivers().find(t => t.sender === sender);
            if (transceiver && (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive')) {
              transceiver.direction = 'sendrecv';
              const offer = await peer.pc.createOffer();
              await peer.pc.setLocalDescription(offer);
              const socket = getSocket();
              socket?.emit('group_call_renegotiate', { chatId, targetUserId, offer: peer.pc.localDescription });
            }
          } else {
            peer.pc.addTrack(screenTrack, localStreamRef.current || screenStream);
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            const socket = getSocket();
            socket?.emit('group_call_renegotiate', { chatId, targetUserId, offer: peer.pc.localDescription });
          }
        }

        screenTrack.onended = () => {
          setIsScreenSharing(false);
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
          }
        };

        setIsScreenSharing(true);
      } catch { console.error('Screen share failed'); }
    }
  }, [isScreenSharing, chatId]);

  // Noise gate with look-ahead: analyse undelayed signal, gate delayed signal
  const applyNoiseGate = useCallback(async () => {
    if (!localStreamRef.current) return;
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
      const OPEN_THRESHOLD = -38;
      const CLOSE_THRESHOLD = -48;
      const CONFIRM_MS = 22;
      const HOLD_TIME = 150;
      const ATTACK = 0.002;
      const RELEASE = 0.02;

      // State machine: 0=closed, 1=pending, 2=open
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

        if (state === 0) {
          if (db > OPEN_THRESHOLD) {
            state = 1;
            pendingSince = now;
          }
        } else if (state === 1) {
          if (db <= CLOSE_THRESHOLD) {
            state = 0;
          } else if (now - pendingSince >= CONFIRM_MS) {
            state = 2;
            holdUntil = now + HOLD_TIME;
            gainNode.gain.setTargetAtTime(1, ctx.currentTime, ATTACK);
          }
        } else {
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

      // Replace on all peers
      for (const [, peer] of peersRef.current) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(gatedTrack);
      }

      noiseGateCtxRef.current = ctx;
      noiseGateGainRef.current = gainNode;
      noiseGateTrackRef.current = gatedTrack;
      setNoiseSuppression(true);
    } catch (err) {
      console.error('Failed to apply noise gate:', err);
    }
  }, [isMuted]);

  const removeNoiseGate = useCallback(async () => {
    // Restore raw mic track to all peers
    if (localStreamRef.current) {
      const rawTrack = localStreamRef.current.getAudioTracks()[0];
      if (rawTrack) {
        for (const [, peer] of peersRef.current) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) await sender.replaceTrack(rawTrack);
        }
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
    setShowMicMenu(false);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = !isMuted;

      const wasGated = noiseSuppression;
      if (wasGated) await removeNoiseGate();

      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => {
          localStreamRef.current!.removeTrack(t);
          t.stop();
        });
        localStreamRef.current.addTrack(newTrack);
      }
      for (const [, peer] of peersRef.current) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(newTrack);
      }
      setActiveMicId(deviceId);
      if (wasGated) await applyNoiseGate();
    } catch (err) {
      console.error('Switch mic failed:', err);
    }
  }, [isMuted, noiseSuppression, removeNoiseGate, applyNoiseGate]);

  // Volume
  const handleVolumeChange = useCallback((vol: number) => {
    const v = Math.max(0, Math.min(1, vol));
    setRemoteVolume(v);
    for (const [, el] of remoteAudioRefs.current) {
      el.volume = v;
    }
  }, []);

  // Socket event handlers
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !isOpen) return;

    const onParticipants = async (data: { chatId: string; participants: ParticipantInfo[] }) => {
      if (data.chatId !== chatId) return;
      const newMap = new Map<string, ParticipantInfo>();
      for (const p of data.participants) {
        newMap.set(p.id, p);
        // Create peer connection to each existing participant (we are the initiator)
        if (!peersRef.current.has(p.id)) {
          await createPeerConnection(p.id, true);
        }
      }
      setParticipants(prev => {
        const merged = new Map(prev);
        for (const [k, v] of newMap) merged.set(k, v);
        return merged;
      });
    };

    const onUserJoined = (data: { chatId: string; userId: string; userInfo: ParticipantInfo }) => {
      if (data.chatId !== chatId) return;
      setParticipants(prev => {
        const next = new Map(prev);
        next.set(data.userId, data.userInfo);
        return next;
      });
      // The new joiner will send us an offer — we wait for it
    };

    const onUserLeft = (data: { chatId: string; userId: string }) => {
      if (data.chatId !== chatId) return;
      const peer = peersRef.current.get(data.userId);
      if (peer) {
        peer.pc.close();
        peersRef.current.delete(data.userId);
      }
      remoteAudioRefs.current.delete(data.userId);
      setParticipants(prev => {
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });
      forceUpdate(n => n + 1);
    };

    const onOffer = async (data: { chatId: string; from: string; offer: RTCSessionDescriptionInit }) => {
      if (data.chatId !== chatId) return;
      let peerState = peersRef.current.get(data.from);
      if (!peerState) {
        peerState = await createPeerConnection(data.from, false);
      }
      await peerState.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerState.pc.createAnswer();
      await peerState.pc.setLocalDescription(answer);
      socket.emit('group_call_answer', { chatId, targetUserId: data.from, answer: peerState.pc.localDescription });
    };

    const onAnswer = async (data: { chatId: string; from: string; answer: RTCSessionDescriptionInit }) => {
      if (data.chatId !== chatId) return;
      const peerState = peersRef.current.get(data.from);
      if (peerState) {
        await peerState.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    };

    const onIceCandidate = (data: { chatId: string; from: string; candidate: RTCIceCandidateInit }) => {
      if (data.chatId !== chatId) return;
      const peerState = peersRef.current.get(data.from);
      if (peerState?.pc.remoteDescription) {
        peerState.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
      }
    };

    const onRenegotiate = async (data: { chatId: string; from: string; offer: RTCSessionDescriptionInit }) => {
      if (data.chatId !== chatId) return;
      const peerState = peersRef.current.get(data.from);
      if (!peerState) return;
      await peerState.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerState.pc.createAnswer();
      await peerState.pc.setLocalDescription(answer);
      socket.emit('group_call_renegotiate_answer', { chatId, targetUserId: data.from, answer: peerState.pc.localDescription });
    };

    const onRenegotiateAnswer = async (data: { chatId: string; from: string; answer: RTCSessionDescriptionInit }) => {
      if (data.chatId !== chatId) return;
      const peerState = peersRef.current.get(data.from);
      if (peerState) {
        await peerState.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    };

    socket.on('group_call_participants', onParticipants);
    socket.on('group_call_user_joined', onUserJoined);
    socket.on('group_call_user_left', onUserLeft);
    socket.on('group_call_offer', onOffer);
    socket.on('group_call_answer', onAnswer);
    socket.on('group_ice_candidate', onIceCandidate);
    socket.on('group_call_renegotiate', onRenegotiate);
    socket.on('group_call_renegotiate_answer', onRenegotiateAnswer);

    return () => {
      socket.off('group_call_participants', onParticipants);
      socket.off('group_call_user_joined', onUserJoined);
      socket.off('group_call_user_left', onUserLeft);
      socket.off('group_call_offer', onOffer);
      socket.off('group_call_answer', onAnswer);
      socket.off('group_ice_candidate', onIceCandidate);
      socket.off('group_call_renegotiate', onRenegotiate);
      socket.off('group_call_renegotiate_answer', onRenegotiateAnswer);
    };
  }, [isOpen, chatId, createPeerConnection]);

  // Auto-join on open
  useEffect(() => {
    if (isOpen && !joined) {
      joinCall();
    }
  }, [isOpen, joined, joinCall]);

  // Sync local video
  useEffect(() => {
    if (!localVideoRef.current) return;
    const desired = isScreenSharing && screenStreamRef.current ? screenStreamRef.current : localStreamRef.current;
    if (desired && localVideoRef.current.srcObject !== desired) {
      localVideoRef.current.srcObject = desired;
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joinedRef.current) {
        const socket = getSocket();
        socket?.emit('group_call_leave', { chatId });
      }
      cleanup();
    };
  }, [chatId, cleanup]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const participantList = Array.from(participants.values());
  const hasLocalVideo = !!(localStreamRef.current?.getVideoTracks().some(t => t.enabled) || isScreenSharing);

  // Grid columns based on participant count
  const totalStreams = participantList.length + 1; // +1 for self
  const gridCols = totalStreams <= 1 ? 1 : totalStreams <= 4 ? 2 : 3;

  return (
    <AnimatePresence>
      {/* Hidden audio elements for each remote participant */}
      {participantList.map(p => (
        <audio
          key={`audio-${p.id}`}
          ref={el => { if (el) remoteAudioRefs.current.set(p.id, el); }}
          autoPlay
          playsInline
        />
      ))}

      {isMinimized && joined ? (
        <motion.div
          key="group-call-minimized"
          initial={{ opacity: 0, y: 50, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.8 }}
          className="fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-2xl glass-strong shadow-2xl shadow-black/50 border border-white/10 cursor-pointer select-none"
          onClick={() => setIsMinimized(false)}
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-500/30 animate-call-wave" />
            <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
              {participantList.length + 1}
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white font-medium truncate max-w-[120px]">{chatName}</p>
            <p className="text-xs text-zinc-400 font-mono">{formatDuration(duration)}</p>
          </div>
          <div className="flex items-center gap-2 ml-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={toggleMic}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button
              onClick={leaveCall}
              className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="group-call-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-surface/90 backdrop-blur-xl overflow-hidden"
          onClick={() => setShowVolumeSlider(false)}
        >
          <div className="absolute inset-0 pointer-events-none opacity-40">
            <div className="absolute top-[10%] left-[20%] w-[50vh] h-[50vh] bg-emerald-500/30 rounded-full blur-[120px] animate-float" />
            <div className="absolute bottom-[10%] right-[20%] w-[50vh] h-[50vh] bg-vortex-500/20 rounded-full blur-[120px] animate-float-delayed" />
          </div>

          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-5xl mx-4 rounded-[2.5rem] glass-strong shadow-2xl shadow-black/50 overflow-hidden border border-white/5"
          >
            {/* Volume slider popup */}
            {showVolumeSlider && (
              <>
                <div className="fixed inset-0 z-[200]" onClick={() => setShowVolumeSlider(false)} />
                <div className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] rounded-xl bg-zinc-800/95 backdrop-blur-md border border-zinc-600 shadow-2xl p-4" onClick={e => e.stopPropagation()}>
                  <div className="text-xs text-zinc-400 uppercase tracking-wider mb-3">{t('volume')}</div>
                  <div className="flex items-center gap-3">
                    <Volume2 size={16} className="text-zinc-400 shrink-0" />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={remoteVolume}
                      onChange={e => handleVolumeChange(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-zinc-600 accent-vortex-500 cursor-pointer"
                    />
                    <span className="text-xs text-zinc-300 w-8 text-right">{Math.round(remoteVolume * 100)}%</span>
                  </div>
                </div>
              </>
            )}
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

            {/* Header */}
            <div className="flex items-center justify-between px-8 py-4 border-b border-white/5">
              <div>
                <h3 className="text-lg font-bold text-white">{chatName}</h3>
                <p className="text-xs text-zinc-400">{participantList.length + 1} {t('participants') || 'участников'} · {formatDuration(duration)}</p>
              </div>
              <button
                onClick={() => setIsMinimized(true)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                title={t('minimize')}
              >
                <Minimize2 size={16} />
              </button>
            </div>

            {/* Participant grid */}
            <div className="p-4" style={{ minHeight: '300px', maxHeight: '60vh', overflowY: 'auto' }}>
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
              >
                {/* Self */}
                <div className="relative bg-zinc-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center border border-white/5">
                  {hasLocalVideo ? (
                    <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl mb-2">
                        {t('you')?.charAt(0).toUpperCase() || 'Я'}
                      </div>
                      {isMuted && <MicOff size={14} className="text-red-400" />}
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-xs text-white">
                    {t('you')} {isMuted ? '🔇' : ''}
                  </div>
                </div>

                {/* Remote participants */}
                {participantList.map(p => {
                  const peer = peersRef.current.get(p.id);
                  const hasVid = peer?.hasVideo;
                  const initials = (p.displayName || p.username).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

                  return (
                    <div key={p.id} className="relative bg-zinc-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center border border-white/5 cursor-pointer" title={t('rightClickVolume')} onContextMenu={(e) => { e.preventDefault(); setShowVolumeSlider(true); }}>
                      {hasVid ? (
                        <video
                          autoPlay
                          playsInline
                          muted
                          ref={el => {
                            if (el && peer?.remoteStream && el.srcObject !== peer.remoteStream) {
                              el.srcObject = peer.remoteStream;
                            }
                          }}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex flex-col items-center">
                          {p.avatar ? (
                            <img src={p.avatar} alt="" className="w-16 h-16 rounded-full object-cover mb-2" />
                          ) : (
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-vortex-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl mb-2">
                              {initials}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-xs text-white truncate max-w-[80%]">
                        {p.displayName || p.username}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Controls */}
            <div className="px-8 pb-8 pt-4 flex items-center justify-center gap-4 flex-wrap">
              {/* Mic with dropdown */}
              <div className="relative">
                <button
                  onClick={toggleMic}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  title={isMuted ? t('unmute') : t('mute')}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <button
                  onClick={async (e) => { e.stopPropagation(); await refreshMicrophones(); setShowMicMenu(!showMicMenu); setShowVolumeSlider(false); }}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-white/70 hover:text-white transition-colors border border-zinc-600"
                >
                  <ChevronUp size={10} />
                </button>
              </div>
              {/* Camera — only for video calls */}
              {initialCallType === 'video' && (
                <button
                  onClick={toggleVideo}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                >
                  {isVideoOff ? <VideoOff size={18} /> : <Video size={18} />}
                </button>
              )}
              <button
                onClick={toggleScreenShare}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-vortex-500/30 text-vortex-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                title={isScreenSharing ? t('stopScreenShare') : t('screenShare')}
              >
                {isScreenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
              </button>
              <button
                onClick={e => { e.stopPropagation(); setShowVolumeSlider(!showVolumeSlider); }}
                className="w-11 h-11 rounded-full flex items-center justify-center transition-colors bg-white/10 text-white hover:bg-white/20"
                title={t('volume')}
              >
                <Volume2 size={18} />
              </button>
              <button
                onClick={toggleNoiseSuppression}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${noiseSuppression ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                title={noiseSuppression ? t('noiseSuppressionOn') : t('noiseSuppressionOff')}
              >
                {noiseSuppression ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
              </button>
              <button
                onClick={leaveCall}
                className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl shadow-red-500/30 transition-all hover:scale-105 ml-2"
              >
                <PhoneOff size={22} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
