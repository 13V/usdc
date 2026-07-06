/**
 * qr.ts — Render Solana Pay URLs as QR codes (terminal + PNG + data URL).
 */

import * as QRCode from "qrcode";

/** Render a string as an ASCII/Unicode QR for the terminal. */
export async function qrToTerminal(data: string): Promise<string> {
  return QRCode.toString(data, { type: "terminal", small: true });
}

/** Write a PNG QR to disk; returns the path. */
export async function qrToPngFile(data: string, filePath: string): Promise<string> {
  await QRCode.toFile(filePath, data, { width: 512, margin: 2 });
  return filePath;
}

/** Produce a `data:image/png;base64,...` URL for embedding in HTML. */
export async function qrToDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, { width: 320, margin: 2 });
}

/** Raw PNG bytes — for the /api/qr endpoint the pay/settle screens use. */
export async function qrToPngBuffer(data: string, width = 380): Promise<Buffer> {
  return QRCode.toBuffer(data, { width, margin: 2 });
}
