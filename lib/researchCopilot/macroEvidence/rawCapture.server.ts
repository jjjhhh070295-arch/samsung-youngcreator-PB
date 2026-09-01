import { createHash } from "node:crypto";
import type {
  PublicMacroCaptureManifest,
  RawMacroCapture,
  SanitizedMacroRequest,
} from "./types";

export function sha256ExactBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createRawMacroCapture(input: {
  bytes: Uint8Array;
  retrievedAt: string;
  responseStatus: number;
  contentType: string;
  sanitizedRequest: SanitizedMacroRequest;
}): RawMacroCapture {
  const copied = Buffer.from(input.bytes);
  const contentHash = sha256ExactBytes(copied);
  return {
    captureId: `macro-raw:${input.sanitizedRequest.providerId}:${input.sanitizedRequest.operation}:${contentHash}`,
    providerId: input.sanitizedRequest.providerId,
    rawBase64: copied.toString("base64"),
    contentHash,
    bodyByteLength: copied.byteLength,
    retrievedAt: input.retrievedAt,
    responseStatus: input.responseStatus,
    contentType: input.contentType,
    sanitizedRequest: {
      ...input.sanitizedRequest,
      seriesIds: [...input.sanitizedRequest.seriesIds],
    },
  };
}

export function decodeRawMacroCapture(capture: RawMacroCapture): string {
  return Buffer.from(capture.rawBase64, "base64").toString("utf8");
}

function capturesAreExact(left: RawMacroCapture, right: RawMacroCapture) {
  return left.captureId === right.captureId
    && left.providerId === right.providerId
    && left.rawBase64 === right.rawBase64
    && left.contentHash === right.contentHash
    && left.bodyByteLength === right.bodyByteLength
    && left.responseStatus === right.responseStatus
    && left.contentType === right.contentType
    && JSON.stringify(left.sanitizedRequest) === JSON.stringify(right.sanitizedRequest);
}

export function preserveRawMacroCapture(
  archive: RawMacroCapture[],
  incoming: RawMacroCapture,
): { ok: true; archive: RawMacroCapture[]; created: boolean } | { ok: false; archive: RawMacroCapture[]; created: false; code: "RAW_CONFLICT" } {
  const existing = archive.find((capture) => capture.captureId === incoming.captureId);
  if (!existing) return { ok: true, archive: [...archive, incoming], created: true };
  if (capturesAreExact(existing, incoming)) return { ok: true, archive, created: false };
  return { ok: false, archive, created: false, code: "RAW_CONFLICT" };
}

export function toPublicMacroCaptureManifest(capture: RawMacroCapture): PublicMacroCaptureManifest {
  return {
    captureId: capture.captureId,
    providerId: capture.providerId,
    contentHash: capture.contentHash,
    bodyByteLength: capture.bodyByteLength,
    retrievedAt: capture.retrievedAt,
    responseStatus: capture.responseStatus,
    contentType: capture.contentType,
    sanitizedRequest: {
      ...capture.sanitizedRequest,
      seriesIds: [...capture.sanitizedRequest.seriesIds],
    },
  };
}
