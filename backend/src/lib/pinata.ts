/**
 * Pinata IPFS helpers.
 *
 * pinFileToPinata  — upload a file from disk → returns ipfs://CID
 * pinJsonToPinata  — upload a JSON object     → returns ipfs://CID
 */

import fs from "fs";

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API = "https://api.pinata.cloud";

if (!PINATA_JWT) {
  console.warn("[pinata] PINATA_JWT not set — IPFS uploads will fail");
}

/** Pinata public gateway prefix for browser-accessible image URLs */
export const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

/** Convert an ipfs:// URI to a Pinata HTTPS gateway URL */
export function ipfsToGateway(ipfsUri: string): string {
  return ipfsUri.replace("ipfs://", `${PINATA_GATEWAY}/`);
}

/**
 * Pin a Buffer to IPFS via Pinata (used when file comes from R2).
 * Returns an ipfs:// URI.
 */
export async function pinBufferToPinata(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name: fileName }));

  const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinata file upload failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}

/**
 * Pin a file from disk to IPFS via Pinata.
 * Returns an ipfs:// URI.
 */
export async function pinFileToPinata(
  filePath: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const fileBytes = fs.readFileSync(filePath);
  const blob = new Blob([fileBytes], { type: mimeType });

  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name: fileName }));

  const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinata file upload failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}

/**
 * Pin a JSON object to IPFS via Pinata.
 * Returns an ipfs:// URI.
 */
export async function pinJsonToPinata(json: object, name: string): Promise<string> {
  const res = await fetch(`${PINATA_API}/pinning/pinJSONToIPFS`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({
      pinataContent: json,
      pinataMetadata: { name },
      pinataOptions: { cidVersion: 1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinata JSON upload failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}
