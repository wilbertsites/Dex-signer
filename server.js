const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Dirs
const UPLOAD_DIR = path.join('/tmp', 'dex-uploads');
const OUTPUT_DIR = path.join('/tmp', 'dex-output');
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionDir = path.join(UPLOAD_DIR, req.sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    // keep original extension
    const ext = path.extname(file.originalname);
    const base = file.fieldname === 'ipa' ? 'app.ipa' : 'cert.p12';
    cb(null, base);
  }
});

// Inject session id before multer runs
app.use((req, res, next) => {
  req.sessionId = uuidv4();
  next();
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'ipa' && !file.originalname.endsWith('.ipa')) {
      return cb(new Error('IPA file must have .ipa extension'));
    }
    if (file.fieldname === 'p12' && !file.originalname.match(/\.(p12|pfx)$/i)) {
      return cb(new Error('Certificate must be a .p12 or .pfx file'));
    }
    cb(null, true);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Cleanup helper
function cleanup(sessionDir) {
  setTimeout(() => {
    fs.rm(sessionDir, { recursive: true, force: true }, () => {});
  }, 5 * 60 * 1000); // clean after 5 min
}

// Sign endpoint
app.post('/sign', upload.fields([
  { name: 'ipa', maxCount: 1 },
  { name: 'p12', maxCount: 1 }
]), async (req, res) => {
  const sessionDir = path.join(UPLOAD_DIR, req.sessionId);
  const outputDir = path.join(OUTPUT_DIR, req.sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    if (!req.files?.ipa || !req.files?.p12) {
      return res.status(400).json({ error: 'Both IPA and P12 files are required.' });
    }

    const ipaPath = req.files.ipa[0].path;
    const p12Path = req.files.p12[0].path;
    const p12Password = req.body.p12password || '';
    const outputName = req.body.outputName?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'signed';
    const outputPath = path.join(outputDir, `${outputName}.ipa`);

    // Build zsign command args
    const args = [
      '-k', p12Path,
      '-o', outputPath,
    ];

    if (p12Password) {
      args.push('-p', p12Password);
    }

    // zsign flag: -z 0 = no compression change, -f = force sign all
    args.push('-z', '0', '-f', ipaPath);

    await new Promise((resolve, reject) => {
      execFile('zsign', args, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
          // zsign exits non-zero on some warnings but still produces output
          if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            resolve();
          } else {
            reject(new Error(stderr || err.message || 'Signing failed'));
          }
        } else {
          resolve();
        }
      });
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('Signed IPA was not produced. Check your certificate and password.');
    }

    // Stream back
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}.ipa"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stat = fs.statSync(outputPath);
    res.setHeader('Content-Length', stat.size);

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);
    fileStream.on('end', () => {
      cleanup(sessionDir);
      cleanup(outputDir);
    });

  } catch (err) {
    cleanup(sessionDir);
    cleanup(outputDir);
    const msg = err.message || 'Unknown error during signing';
    // Friendly message for common errors
    let friendly = msg;
    if (msg.includes('password') || msg.includes('MAC') || msg.includes('PKCS12')) {
      friendly = 'Invalid P12 password or corrupted certificate file.';
    } else if (msg.includes('not found') || msg.includes('No such')) {
      friendly = 'File processing error. Try uploading again.';
    }
    res.status(500).json({ error: friendly });
  }
});

// Health check for Render
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Dex Signer running on :${PORT}`);
});
