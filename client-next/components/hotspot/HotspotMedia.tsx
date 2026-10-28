'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Play, X, ImageOff, RotateCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { MediaItem } from '../../types';

interface Props {
  media: MediaItem[];
}

/** Compact responsive grid that mirrors X/Twitter's media layout. */
export function HotspotMedia({ media }: Props) {
  const [activeVideo, setActiveVideo] = useState<MediaItem | null>(null);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  if (!media || media.length === 0) return null;

  // X uses a fixed grid pattern based on count: 1 = full, 2 = 2-col, 3 = first
  // big + 2 stacked, 4 = 2x2.
  const count = Math.min(media.length, 4);
  const items = media.slice(0, count);

  const layoutClass =
    count === 1 ? 'grid-cols-1' :
    count === 2 ? 'grid-cols-2' :
    count === 3 ? 'grid-cols-2' :
                  'grid-cols-2';

  return (
    <>
      <div
        className={cn(
          'grid gap-1 mt-3 rounded-xl overflow-hidden border border-[var(--card-border)]',
          layoutClass,
        )}
      >
        {items.map((m, i) => {
          // 3-up layout: first item spans both rows
          const spanClass = count === 3 && i === 0 ? 'row-span-2' : '';
          return (
            <MediaTile
              key={`${m.type}:${m.url}:${m.previewUrl || ''}`}
              item={m}
              spanClass={spanClass}
              singleItem={count === 1}
              onPlayVideo={() => setActiveVideo(m)}
              onOpenImage={() => setLightbox(m)}
            />
          );
        })}
      </div>

      {/* Inline video player */}
      {activeVideo && (
        <VideoModal item={activeVideo} onClose={() => setActiveVideo(null)} />
      )}

      {/* Image lightbox */}
      {lightbox && (
        <ImageLightbox item={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function MediaTile({
  item,
  spanClass,
  singleItem,
  onPlayVideo,
  onOpenImage,
}: {
  item: MediaItem;
  spanClass: string;
  singleItem: boolean;
  onPlayVideo: () => void;
  onOpenImage: () => void;
}) {
  const isVideo = item.type === 'video' || item.type === 'gif';
  const src = isVideo ? (item.previewUrl ?? item.url) : item.url;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <button
      type="button"
      aria-label={isVideo ? '播放报道视频' : failed ? '重新加载报道图片' : '放大报道配图'}
      onClick={() => {
        if (isVideo) onPlayVideo();
        else if (failed) { setAttempt(value => value + 1); setFailed(false); }
        else onOpenImage();
      }}
      className={cn(
        'group/media relative overflow-hidden focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]',
        // Use darker bg for better contrast when image loads
        'bg-slate-100 dark:bg-slate-800',
        spanClass,
        // Single item: taller but constrained; multi: square and smaller
        singleItem ? 'aspect-video max-h-[280px] w-full' : 'aspect-square max-h-[200px] w-full',
      )}
    >
      {failed ? <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
        <ImageOff className="h-6 w-6 text-[var(--text-muted)]" />
        <span>{isVideo ? '视频预览加载失败' : '图片加载失败'}</span>
        <span className="flex items-center gap-1 text-xs text-[var(--accent-blue)]">{isVideo ? <Play className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}{isVideo ? '点击播放视频' : '点击重试'}</span>
      </span> : <Image
        key={attempt}
        src={src}
        unoptimized
        fill
        referrerPolicy="no-referrer"
        loading="lazy"
        alt={isVideo ? '报道视频预览' : '报道配图'}
        sizes="(max-width: 768px) 50vw, 25vw"
        className={cn(isVideo ? 'object-contain' : 'object-cover', 'transition-transform group-hover/media:scale-[1.02]')}
        onError={() => setFailed(true)}
      />}
      {isVideo && !failed && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-14 h-14 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/40 shadow-xl group-hover/media:bg-black/80 group-hover/media:scale-110 transition">
            <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
          </span>
        </span>
      )}
      {item.type === 'gif' && (
        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white tracking-wider">
          GIF
        </span>
      )}
    </button>
  );
}

function VideoModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return (
    <dialog ref={dialog} aria-label="报道视频" onCancel={onClose}
      className="fixed inset-0 z-50 w-full h-full max-w-none max-h-none m-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        aria-label="关闭"
      >
        <X className="w-5 h-5" />
      </button>
      <video
        src={item.url}
        poster={item.previewUrl}
        controls
        autoPlay
        muted
        playsInline
        className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </dialog>
  );
}

function ImageLightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return (
    <dialog ref={dialog} aria-label="报道配图" onCancel={onClose}
      className="fixed inset-0 z-50 w-full h-full max-w-none max-h-none m-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        aria-label="关闭"
      >
        <X className="w-5 h-5" />
      </button>
      {failed ? <div className="flex flex-col items-center gap-4 text-white" onClick={event => event.stopPropagation()}>
        <ImageOff className="h-8 w-8" />
        <p role="status">图片加载失败</p>
        <button type="button" onClick={() => { setAttempt(value => value + 1); setFailed(false); }} className="flex min-h-11 items-center gap-2 rounded-lg bg-white/15 px-4 hover:bg-white/25">
          <RotateCw className="h-4 w-4" />重新加载
        </button>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">打开原图</a>
      </div> : <Image
        key={attempt}
        src={item.url}
        alt="报道配图"
        unoptimized
        referrerPolicy="no-referrer"
        width={0}
        height={0}
        sizes="100vw"
        className="max-w-full max-h-[90vh] w-auto h-auto rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onError={() => setFailed(true)}
      />}
    </dialog>
  );
}
