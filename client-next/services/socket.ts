import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['polling', 'websocket']
    });

    socket.on('connect', () => {
      console.log('🔌 Socket connected:', socket?.id);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
    });

    socket.on('connect_error', (error) => {
      console.error('🔌 Socket connection error:', error);
    });
  }

  return socket;
}

export function subscribeToKeywords(keywords: string[]): void {
  const s = getSocket();
  s.emit('subscribe', keywords);
}

export interface HotspotEvent {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  importance: string;
  summary: string | null;
  keyword?: { text: string } | null;
}

export function onNewHotspot(callback: (hotspot: HotspotEvent) => void): () => void {
  const s = getSocket();
  s.on('hotspot:new', callback);
  return () => s.off('hotspot:new', callback);
}

export interface ScanStatusEvent {
  isScanning: boolean;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
  error?: string | null;
}

export function onScanStatus(callback: (status: ScanStatusEvent) => void): () => void {
  const s = getSocket();
  s.on('scan:status', callback);
  return () => s.off('scan:status', callback);
}

export interface ScanProgressEvent {
  phase:
    | 'sources_start'
    | 'sources_done'
    | 'keywords_skipped'
    | 'keywords_start'
    | 'keyword_done'
    | 'keywords_done';
  total?: number;
  done?: number;
  keyword?: string;
  found?: number;
  ts: number;
}

export function onScanProgress(callback: (progress: ScanProgressEvent) => void): () => void {
  const s = getSocket();
  s.on('scan:progress', callback);
  return () => s.off('scan:progress', callback);
}
