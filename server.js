const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join('/tmp', 'dex-uploads');
const OUTPUT_DIR = path.join('/tmp', 'dex-output');
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => { req.sessionId = uuidv4(); next(); });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(UPLOAD_DIR, req.sessionId);
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === 'ipa') {
      cb(null, file.originalname.match(/\.zip$/i) ? 'app.zip' : 'app.ipa');
    } else {
      cb(null, 'cert.p12');
    }
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'ipa' && !file.originalname.match(/\.(ipa|zip)$/i))
      return cb(new Error('File must be .ipa or .zip'));
    if (file.fieldname === 'p12' && !file.originalname.match(/\.(p12|pfx)$/i))
      return cb(new Error('Certificate must be .p12 or .pfx'));
    cb(null, true);
  }
});

function cleanup(dir) {
  setTimeout(() => fs.rm(dir, { recursive: true, force: true }, () => {}), 5 * 60 * 1000);
}

function extractIpaFromZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    exec(`unzip -o "${zipPath}" -d "${destDir}" 2>&1`, () => {
      exec(`find "${destDir}" -name "*.ipa" | head -1`, (err, out) => {
        const found = out.trim();
        if (found) resolve(found);
        else reject(new Error('No .ipa file found inside the ZIP.'));
      });
    });
  });
}

app.post('/sign', upload.fields([
  { name: 'ipa', maxCount: 1 },
  { name: 'p12', maxCount: 1 }
]), async (req, res) => {
  const sessionDir = path.join(UPLOAD_DIR, req.sessionId);
  const outputDir = path.join(OUTPUT_DIR, req.sessionId);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    if (!req.files?.ipa) return res.status(400).json({ error: 'No IPA or ZIP file provided.' });

    let p12Path;
    if (req.files?.p12) {
      p12Path = req.files.p12[0].path;
    } else if (req.body.p12base64) {
      p12Path = path.join(sessionDir, 'cert.p12');
      fs.writeFileSync(p12Path, Buffer.from(req.body.p12base64, 'base64'));
    } else {
      return res.status(400).json({ error: 'No certificate provided.' });
    }

    const p12Password = req.body.p12password || '';
    const outputName = (req.body.outputName || 'signed').replace(/[^a-zA-Z0-9._-]/g, '_');
    const outputPath = path.join(outputDir, `${outputName}.ipa`);

    let ipaPath = req.files.ipa[0].path;
    if (ipaPath.endsWith('.zip')) {
      const extractDir = path.join(sessionDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      ipaPath = await extractIpaFromZip(ipaPath, extractDir);
    }

    const args = ['-k', p12Path, '-o', outputPath];
    if (p12Password) args.push('-p', p12Password);
    args.push('-z', '0', '-f', ipaPath);

    await new Promise((resolve, reject) => {
      execFile('zsign', args, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) resolve();
          else reject(new Error(stderr || err.message || 'Signing failed'));
        } else resolve();
      });
    });

    if (!fs.existsSync(outputPath)) throw new Error('Signed IPA was not produced.');

    res.setHeader('Content-Disposition', `attachment; filename="${outputName}.ipa"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(outputPath).size);
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', () => { cleanup(sessionDir); cleanup(outputDir); });

  } catch (err) {
    cleanup(sessionDir);
    cleanup(outputDir);
    let msg = err.message || 'Unknown error';
    if (msg.includes('password') || msg.includes('MAC') || msg.includes('PKCS12')) msg = 'Wrong P12 password or bad certificate.';
    res.status(500).json({ error: msg });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Dex Signer :${PORT}`));
