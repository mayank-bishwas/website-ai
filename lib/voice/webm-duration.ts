type Vint = { value: number; length: number; unknownSize: boolean };

function readVint(bytes: Uint8Array, offset: number, identifier = false): Vint | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  let marker = 0x80;
  let length = 1;
  while (length <= 8 && (first & marker) === 0) {
    marker >>= 1;
    length += 1;
  }
  if (length > (identifier ? 4 : 8) || offset + length > bytes.length) return null;

  let value = identifier ? first : first & (marker - 1);
  const unknownSize = !identifier && value === marker - 1 && bytes.subarray(offset + 1, offset + length).every((byte) => byte === 0xff);
  if (unknownSize) return { value: 0, length, unknownSize: true };
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index];
  if (!Number.isSafeInteger(value)) return null;
  return { value, length, unknownSize: false };
}

type Element = { id: number; dataStart: number; end: number; unknownSize: boolean };

function readElement(bytes: Uint8Array, offset: number, parentEnd: number): Element | null {
  const id = readVint(bytes, offset, true);
  if (!id) return null;
  const size = readVint(bytes, offset + id.length);
  if (!size) return null;
  const dataStart = offset + id.length + size.length;
  const end = size.unknownSize ? parentEnd : dataStart + size.value;
  if (end > parentEnd || end < dataStart) return null;
  return { id: id.value, dataStart, end, unknownSize: size.unknownSize };
}

function unsigned(bytes: Uint8Array, start: number, end: number): number | null {
  if (end <= start || end - start > 8) return null;
  let result = 0;
  for (let index = start; index < end; index += 1) result = result * 256 + bytes[index];
  return Number.isSafeInteger(result) ? result : null;
}

function parseOpusDuration(bytes: Uint8Array, payloadStart: number, end: number): number | null {
  if (payloadStart >= end) return null;
  const toc = bytes[payloadStart];
  const config = toc >> 3;
  const frameCode = toc & 3;
  const frameDurationMs = config < 12
    ? [10, 20, 40, 60][config % 4]
    : config < 16
      ? [10, 20][config % 2]
      : [2.5, 5, 10, 20][config % 4];
  let frames = frameCode === 0 ? 1 : 2;
  if (frameCode === 3) {
    if (payloadStart + 1 >= end) return null;
    frames = bytes[payloadStart + 1] & 0x3f;
  }
  if (frames < 1 || frames > 48 || frames * frameDurationMs > 120) return null;
  return frames * frameDurationMs;
}

function lacedFrameSizes(bytes: Uint8Array, start: number, end: number, lacing: number): { sizes: number[]; dataStart: number } | null {
  const countValue = bytes[start];
  const frameCount = countValue + 1;
  if (frameCount < 2 || frameCount > 256) return null;
  let cursor = start + 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    for (let frameIndex = 0; frameIndex < frameCount - 1; frameIndex += 1) {
      let size = 0;
      let byte: number;
      do {
        if (cursor >= end) return null;
        byte = bytes[cursor++];
        size += byte;
      } while (byte === 255);
      sizes.push(size);
    }
  } else if (lacing === 2) {
    const remaining = end - cursor;
    if (remaining % frameCount !== 0) return null;
    return { sizes: Array(frameCount).fill(remaining / frameCount), dataStart: cursor };
  } else if (lacing === 3) {
    const first = readVint(bytes, cursor);
    if (!first || first.unknownSize) return null;
    cursor += first.length;
    sizes.push(first.value);
    for (let frameIndex = 1; frameIndex < frameCount - 1; frameIndex += 1) {
      const deltaValue = readVint(bytes, cursor);
      if (!deltaValue || deltaValue.unknownSize) return null;
      cursor += deltaValue.length;
      const bias = 2 ** (7 * deltaValue.length - 1) - 1;
      const nextSize = sizes[sizes.length - 1] + deltaValue.value - bias;
      if (!Number.isSafeInteger(nextSize) || nextSize < 0) return null;
      sizes.push(nextSize);
    }
  } else {
    return null;
  }

  const remaining = end - cursor;
  const lastSize = remaining - sizes.reduce((total, size) => total + size, 0);
  if (!Number.isSafeInteger(lastSize) || lastSize < 0) return null;
  sizes.push(lastSize);
  if (sizes.some((size) => size <= 0) || sizes.reduce((total, size) => total + size, 0) !== remaining) return null;
  return { sizes, dataStart: cursor };
}

function blockAudioDuration(bytes: Uint8Array, start: number, end: number, flags: number): number | null {
  const payloadStart = start + 3;
  const lacing = (flags & 0x06) >> 1;
  if (lacing === 0) return parseOpusDuration(bytes, payloadStart, end);
  const frames = lacedFrameSizes(bytes, payloadStart, end, lacing);
  if (!frames) return null;
  let cursor = frames.dataStart;
  let totalMs = 0;
  for (const size of frames.sizes) {
    const frameEnd = cursor + size;
    if (frameEnd > end) return null;
    const duration = parseOpusDuration(bytes, cursor, frameEnd);
    if (duration === null) return null;
    totalMs += duration;
    cursor = frameEnd;
  }
  return cursor === end ? totalMs : null;
}

function parseBlock(bytes: Uint8Array, start: number, end: number): { trackNumber: number; relativeTimecode: number; durationMs: number } | null {
  const track = readVint(bytes, start);
  if (!track || start + track.length + 3 > end) return null;
  const timecodeOffset = start + track.length;
  const raw = bytes[timecodeOffset] * 256 + bytes[timecodeOffset + 1];
  const flags = bytes[timecodeOffset + 2];
  const durationMs = blockAudioDuration(bytes, timecodeOffset, end, flags);
  if (durationMs === null) return null;
  return { trackNumber: track.value, relativeTimecode: raw > 0x7fff ? raw - 0x10000 : raw, durationMs };
}

type OpusTrack = { trackNumber: number; isAudio: boolean; isOpus: boolean };

function findTracks(bytes: Uint8Array, start: number, end: number): OpusTrack[] | null {
  const tracks: OpusTrack[] = [];
  let cursor = start;
  while (cursor < end) {
    const trackEntry = readElement(bytes, cursor, end);
    if (!trackEntry || trackEntry.unknownSize) return null;
    if (trackEntry.id === 0xae) {
      let child = trackEntry.dataStart;
      let trackNumber: number | null = null;
      let trackType: number | null = null;
      let codecId: string | null = null;
      while (child < trackEntry.end) {
        const field = readElement(bytes, child, trackEntry.end);
        if (!field || field.unknownSize) return null;
        if (field.id === 0xd7) trackNumber = unsigned(bytes, field.dataStart, field.end);
        if (field.id === 0x83) trackType = unsigned(bytes, field.dataStart, field.end);
        if (field.id === 0x86) codecId = new TextDecoder().decode(bytes.subarray(field.dataStart, field.end));
        child = field.end;
      }
      if (trackNumber !== null && trackType !== null && codecId !== null) {
        tracks.push({ trackNumber, isAudio: trackType === 2, isOpus: codecId === "A_OPUS" });
      }
    }
    cursor = trackEntry.end;
  }
  return tracks;
}

function findBlocks(bytes: Uint8Array, start: number, end: number): Array<{ trackNumber: number; relativeTimecode: number; durationMs: number }> | null {
  const values: Array<{ trackNumber: number; relativeTimecode: number; durationMs: number }> = [];
  let cursor = start;
  while (cursor < end) {
    const element = readElement(bytes, cursor, end);
    if (!element || element.unknownSize) return null;
    if (element.id === 0xa3) {
      const block = parseBlock(bytes, element.dataStart, element.end);
      if (!block) return null;
      values.push(block);
    } else if (element.id === 0xa0) {
      let child = element.dataStart;
      while (child < element.end) {
        const nested = readElement(bytes, child, element.end);
        if (!nested || nested.unknownSize) return null;
        if (nested.id === 0xa1) {
          const block = parseBlock(bytes, nested.dataStart, nested.end);
          if (!block) return null;
          values.push(block);
        }
        child = nested.end;
      }
    }
    cursor = element.end;
  }
  return values;
}

function clusterTimes(bytes: Uint8Array, cluster: Element, segmentEnd: number): { blocks: Array<{ trackNumber: number; relativeTimecode: number; durationMs: number }>; timecode: number; end: number } | null {
  let cursor = cluster.dataStart;
  let timecode = 0;
  let timecodeFound = false;
  const blocks: Array<{ trackNumber: number; relativeTimecode: number; durationMs: number }> = [];
  const clusterEnd = cluster.unknownSize ? segmentEnd : cluster.end;
  while (cursor < clusterEnd) {
    const nextId = readVint(bytes, cursor, true);
    if (!nextId) return null;
    if (cluster.unknownSize && nextId.value === 0x1f43b675 && cursor > cluster.dataStart) break;
    const element = readElement(bytes, cursor, clusterEnd);
    if (!element || element.unknownSize) return null;
    if (element.id === 0xe7) {
      const value = unsigned(bytes, element.dataStart, element.end);
      if (value === null) return null;
      timecode = value;
      timecodeFound = true;
    } else if (element.id === 0xa3) {
      const block = parseBlock(bytes, element.dataStart, element.end);
      if (!block) return null;
      blocks.push(block);
    } else if (element.id === 0xa0) {
      const nested = findBlocks(bytes, element.dataStart, element.end);
      if (!nested) return null;
      for (const block of nested) blocks.push(block);
    }
    cursor = element.end;
  }
  if (!timecodeFound || blocks.length === 0) return null;
  return { blocks, timecode, end: cursor };
}

export function getWebmDurationMs(input: ArrayBuffer | Uint8Array): number | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16) return null;
  const header = readElement(bytes, 0, bytes.length);
  if (!header || header.id !== 0x1a45dfa3 || header.unknownSize) return null;
  const segment = readElement(bytes, header.end, bytes.length);
  if (!segment || segment.id !== 0x18538067) return null;

  const segmentEnd = segment.unknownSize ? bytes.length : segment.end;
  let timecodeScaleNs = 1_000_000;
  let cursor = segment.dataStart;
  let maximumTimestampMs = 0;
  let decodedAudioDurationMs = 0;
  let audioTracks: OpusTrack[] = [];
  while (cursor < segmentEnd) {
    const element = readElement(bytes, cursor, segmentEnd);
    if (!element) return null;
    if (element.id === 0x1549a966) {
      let infoCursor = element.dataStart;
      while (infoCursor < element.end) {
        const infoElement = readElement(bytes, infoCursor, element.end);
        if (!infoElement || infoElement.unknownSize) return null;
        if (infoElement.id === 0x2ad7b1) {
          const value = unsigned(bytes, infoElement.dataStart, infoElement.end);
          if (value === null || value <= 0) return null;
          timecodeScaleNs = value;
        }
        infoCursor = infoElement.end;
      }
    } else if (element.id === 0x1654ae6b) {
      const tracks = findTracks(bytes, element.dataStart, element.end);
      if (!tracks) return null;
      audioTracks = tracks;
    } else if (element.id === 0x1f43b675) {
      const cluster = clusterTimes(bytes, element, segmentEnd);
      if (!cluster) return null;
      for (const block of cluster.blocks) {
        if (!audioTracks.some((track) => track.trackNumber === block.trackNumber && track.isAudio && track.isOpus)) return null;
        const timestampMs = (cluster.timecode + block.relativeTimecode) * timecodeScaleNs / 1_000_000;
        if (!Number.isFinite(timestampMs)) return null;
        maximumTimestampMs = Math.max(maximumTimestampMs, timestampMs);
        decodedAudioDurationMs += block.durationMs;
      }
      cursor = cluster.end;
      continue;
    }
    if (element.unknownSize) {
      if (element.id !== 0x1f43b675) return null;
      cursor = segmentEnd;
    } else {
      cursor = element.end;
    }
  }
  if (!audioTracks.some((track) => track.isAudio && track.isOpus) || decodedAudioDurationMs <= 0 || maximumTimestampMs > 60_000) return null;
  return Math.max(decodedAudioDurationMs, maximumTimestampMs);
}

