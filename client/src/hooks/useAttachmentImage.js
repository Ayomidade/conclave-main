import { useEffect, useState } from "react";
import { getAttachmentBlob } from "@/services/attachments.service";

export default function useAttachmentImage(attachment) {
  const id = attachment?.id;
  const url = attachment?.url;
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    let objectUrl = null;
    setSrc(null);
    setFailed(false);

    getAttachmentBlob({ id, url })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, url]);

  return { src, failed };
}
