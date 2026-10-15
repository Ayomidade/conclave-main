import IconAudio from '@/assets/icons/audio-file.svg?react';
import IconDocument from '@/assets/icons/document.svg?react';
import IconDownload from '@/assets/icons/download.svg?react';
import IconFile from '@/assets/icons/file.svg?react';
import IconImage from '@/assets/icons/image.svg?react';
import IconSpreadsheet from '@/assets/icons/spreadsheet.svg?react';
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import useAttachmentImage from '@/hooks/useAttachmentImage';
import {
  downloadAttachment,
  getAttachmentBlob,
  getCachedAttachmentBlob,
} from '@/services/attachments.service';

/**
 * A human-readable byte count.
 *
 * Binary units rather than decimal, matching the upload limits — showing
 * "26.2 MB" for a file under the limit is the kind of small lie that makes a
 * limit look arbitrary.
 */
function formatSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function iconFor(mimeType = '') {
  if (mimeType.startsWith('image/')) return IconImage;
  if (mimeType.startsWith('audio/')) return IconAudio;
  if (mimeType.startsWith('video/')) return IconFile;
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return IconSpreadsheet;
  if (mimeType.startsWith('text/') || mimeType.includes('pdf') || mimeType.includes('document')) {
    return IconDocument;
  }
  return IconFile;
}

function FileAttachment({ attachment }) {
  const Icon = iconFor(attachment.mime_type);
  const size = formatSize(attachment.size);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // An optimistic row has no id yet, so there is nothing to fetch.
  const ready = Boolean(attachment.id);

  const handleClick = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await downloadAttachment(attachment);
    } catch (err) {
      toast({ title: 'Download failed', description: err.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!ready || busy}
      className="group flex w-full max-w-sm items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-70"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">
          {attachment.filename || 'Attachment'}
        </span>
        <span className="block text-metadata text-muted">{ready ? size : 'Sending…'}</span>
      </span>
      <IconDownload
        className={`h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-brand ${
          busy ? 'animate-pulse' : ''
        }`}
        aria-hidden="true"
      />
      <span className="sr-only">Download {attachment.filename}</span>
    </button>
  );
}

function useObjectUrl(blob) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function ProgressRing({ fraction }) {
  const percent = Math.round(fraction * 100);
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="relative grid h-12 w-12 place-items-center rounded-full bg-surface text-metadata text-ink"
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="16" pathLength="100" className="fill-none stroke-line" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r="16"
          pathLength="100"
          className="fill-none stroke-brand"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${percent} 100`}
        />
      </svg>
      {percent}
    </span>
  );
}

function ImageAttachment({ attachment, tile = false }) {
  const { src, failed } = useAttachmentImage(attachment);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const save = () =>
    downloadAttachment(attachment).catch((err) =>
      toast({ title: 'Download failed', description: err.message, tone: 'error' }),
    );

  if (failed) return <FileAttachment attachment={attachment} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!src}
        aria-label={`Open ${attachment.filename}`}
        className={`relative block w-full overflow-hidden bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
          tile ? '' : 'max-w-xs rounded-xl'
        }`}
      >
        {src ? (
          <img
            src={src}
            alt={attachment.filename}
            className={`w-full object-cover ${tile ? 'aspect-square' : 'max-h-72'}`}
          />
        ) : (
          <span
            className={`block w-full animate-pulse bg-line ${tile ? 'aspect-square' : 'aspect-[4/3]'}`}
            aria-hidden="true"
          />
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={attachment.filename}
        footer={
          <Button variant="secondary" onClick={save}>
            Download
          </Button>
        }
      >
        {src && (
          <img
            src={src}
            alt={attachment.filename}
            className="mx-auto max-h-[65vh] w-auto max-w-full object-contain"
          />
        )}
      </Modal>
    </>
  );
}

/**
 * A video bubble, WhatsApp style. If the file is already on this device (we
 * sent it, or opened it before) it plays at once. Otherwise it shows a tile
 * with the size and a download button, and plays from the local copy once the
 * download finishes.
 */
function VideoAttachment({ attachment, tile = false }) {
  const { toast } = useToast();
  const [blob, setBlob] = useState(null);
  const [progress, setProgress] = useState(null);
  const [playFailed, setPlayFailed] = useState(false);
  const src = useObjectUrl(blob);
  const size = formatSize(attachment.size);

  useEffect(() => {
    let active = true;
    getCachedAttachmentBlob(attachment).then((cached) => {
      if (active && cached) setBlob(cached);
    });
    return () => {
      active = false;
    };
  }, [attachment.url]);

  const load = async () => {
    if (!attachment.id || progress !== null) return;
    setProgress(0);
    try {
      setBlob(await getAttachmentBlob(attachment, { onProgress: setProgress }));
    } catch (err) {
      toast({ title: 'Could not load the video', description: err.message, tone: 'error' });
    } finally {
      setProgress(null);
    }
  };

  if (playFailed) return <FileAttachment attachment={attachment} />;

  if (src) {
    return (
      <video
        src={`${src}#t=0.001`}
        controls
        playsInline
        preload="metadata"
        onError={() => setPlayFailed(true)}
        aria-label={attachment.filename}
        className={`w-full bg-canvas object-cover ${tile ? 'aspect-square' : 'max-h-80 max-w-xs rounded-xl'}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={load}
      disabled={!attachment.id || progress !== null}
      aria-label={`Download video ${attachment.filename || ''}, ${size}`}
      className={`grid w-full place-items-center overflow-hidden border border-line bg-canvas text-ink transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-default ${
        tile ? 'aspect-square' : 'aspect-video max-w-xs rounded-xl'
      }`}
    >
      <span className="flex max-w-full flex-col items-center gap-2 px-4 text-center">
        {progress === null ? (
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface text-brand">
            <IconDownload className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : (
          <ProgressRing fraction={progress} />
        )}
        <span className="max-w-full truncate text-label">{attachment.filename || 'Video'}</span>
        <span className="text-metadata text-muted">
          {progress === null ? `Tap to download · ${size}` : 'Downloading…'}
        </span>
      </span>
    </button>
  );
}

const isMedia = (attachment) =>
  Boolean(attachment.id) && /^(image|video)\//.test(attachment.mime_type || '');

function MediaItem({ attachment, tile }) {
  return (attachment.mime_type || '').startsWith('video/') ? (
    <VideoAttachment attachment={attachment} tile={tile} />
  ) : (
    <ImageAttachment attachment={attachment} tile={tile} />
  );
}

/** A message's attachments: photos and videos as one grid, files as cards. */
export function AttachmentGroup({ attachments = [] }) {
  const media = attachments.filter(isMedia);
  const files = attachments.filter((attachment) => !isMedia(attachment));
  const tiled = media.length > 1;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {media.length > 0 && (
        <div
          className={
            tiled
              ? 'grid w-full max-w-xs grid-cols-2 gap-1 overflow-hidden rounded-xl'
              : 'w-full max-w-xs'
          }
        >
          {media.map((attachment) => (
            <MediaItem
              key={attachment.id || attachment.url}
              attachment={attachment}
              tile={tiled}
            />
          ))}
        </div>
      )}
      {files.map((attachment) => (
        <FileAttachment key={attachment.id || attachment.url} attachment={attachment} />
      ))}
    </div>
  );
}

export default function AttachmentCard({ attachment }) {
  return isMedia(attachment) ? (
    <MediaItem attachment={attachment} tile={false} />
  ) : (
    <FileAttachment attachment={attachment} />
  );
}
