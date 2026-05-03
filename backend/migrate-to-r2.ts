import "dotenv/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET  = process.env.R2_BUCKET!;
const UPLOADS = path.join(process.cwd(), "uploads");

async function main() {
  if (!fs.existsSync(UPLOADS)) {
    console.log("No uploads directory found — nothing to migrate.");
    return;
  }

  const pets = fs.readdirSync(UPLOADS).filter((d) => d !== "_tmp" && !d.startsWith("."));
  console.log(`Migrating ${pets.length} pets to R2 bucket "${BUCKET}"…\n`);

  let ok = 0, fail = 0;

  for (const petId of pets) {
    const dir   = path.join(UPLOADS, petId);
    const stat  = fs.statSync(dir);
    if (!stat.isDirectory()) continue;

    const files = [
      { name: "spritesheet.webp", mime: "image/webp"       },
      { name: "pet.json",         mime: "application/json" },
    ];

    for (const { name, mime } of files) {
      const fp = path.join(dir, name);
      if (!fs.existsSync(fp)) { console.log(`  SKIP  ${petId}/${name}`); continue; }
      try {
        const body = fs.readFileSync(fp);
        await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${petId}/${name}`, Body: body, ContentType: mime }));
        console.log(`  ✓  ${petId}/${name}  (${(body.length / 1024).toFixed(1)} KB)`);
        ok++;
      } catch (err: any) {
        console.error(`  ✗  ${petId}/${name}: ${err.message}`);
        fail++;
      }
    }
  }

  console.log(`\nDone — ${ok} uploaded, ${fail} failed.`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
