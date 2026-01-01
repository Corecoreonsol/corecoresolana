const express = require("express");
const multer = require("multer");
const cors = require("cors");
const OpenAI = require("openai");
const { toFile } = require("openai/uploads");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const dotenv = require("dotenv");

dotenv.config();

// Whale verification module
let whaleVerifyRoutes = null;
let groupMonitor = null;
try {
    whaleVerifyRoutes = require("./whale-verify/routes");
    groupMonitor = require("./whale-verify/group-monitor");
    console.log("✅ Whale verification module loaded");
    
    // Start monitoring group members after 5 seconds
    setTimeout(() => {
        if (groupMonitor && process.env.TELEGRAM_BOT_TOKEN) {
            groupMonitor.startMonitoring();
        }
    }, 5000);
} catch (error) {
    console.error("❌ Failed to load whale verification module:", error.message);
}

const app = express();

// Performance optimizations
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://corecoreonsol.vercel.app', 'https://your-domain.com'] 
    : true,
  credentials: true
}));

// Compress responses
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request logging with performance metrics
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`Response time: ${duration}ms`);
    return originalSend.call(this, data);
  };
  
  next();
});

// Optimized multer configuration
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // Increase to 15MB to accommodate larger PNGs
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
});

// Health check with system info
app.get("/api/health", (_req, res) => {
  res.json({ 
    ok: true, 
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint
app.get("/api/debug", (_req, res) => {
  res.json({ 
    message: "CORE PFP Generator API - Optimized", 
    endpoints: ["/api/health", "/api/generate-avatar", "/api/debug"],
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    version: "2.0.0"
  });
});

// Optimized avatar generation
app.post("/api/generate-avatar", upload.single("image"), async (req, res) => {
  const requestStart = Date.now();
  console.log("=== OPTIMIZED GENERATE AVATAR REQUEST ===");
  console.log("File size:", req.file?.size, "bytes");
  console.log("File type:", req.file?.mimetype);
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No image uploaded",
        code: "MISSING_FILE"
      });
    }

    // Optimize image before sending to OpenAI
    let optimizedBuffer;
    try {
      optimizedBuffer = await sharp(req.file.buffer)
        .resize(1024, 1024, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ 
          quality: 85,
          progressive: true
        })
        .toBuffer();
      
      console.log(`Image optimized: ${req.file.size} -> ${optimizedBuffer.length} bytes`);
    } catch (sharpError) {
      console.error("Image optimization failed:", sharpError);
      optimizedBuffer = req.file.buffer; // Fallback to original
    }

    const enhancedStylePrompt = `Transform this image with a futuristic cyberpunk aesthetic featuring:
- Intense electric-blue aura and neon outline around the subject
- Subtle cosmic blue energy particles and mist in the background
- Glowing infinity symbols (∞) floating subtly around the edges
- Dramatic lighting with vivid blue highlights and deep shadows
- High contrast digital art style with sharp details
- Ethereal, otherworldly atmosphere
- Keep the original subject recognizable but make it look powered by cosmic blue energy
- Style should feel like a premium digital art piece with professional quality`;

    // Create optimized file object
    const imageFile = new File([optimizedBuffer], req.file.originalname || 'image.jpg', {
      type: 'image/jpeg'
    });
    
    console.log("Sending request to OpenAI...");
    const openAIStart = Date.now();
    
    // Use optimized OpenAI call
    const response = await openai.images.edit({
      model: "gpt-image-1", 
      image: imageFile,
      prompt: enhancedStylePrompt,
      size: "1024x1024"
    });

    const openAIDuration = Date.now() - openAIStart;
    console.log(`OpenAI response time: ${openAIDuration}ms`);

    const dataItem = response?.data?.[0];
    if (!dataItem?.b64_json && !dataItem?.url) {
      console.error("OpenAI returned unexpected payload", response);
      return res.status(502).json({ 
        error: "OpenAI did not return an image",
        code: "NO_IMAGE_RETURNED"
      });
    }

    // Handle response efficiently
    let imageData;
    if (dataItem.b64_json) {
      imageData = dataItem.b64_json;
    } else if (dataItem.url) {
      console.log("Fetching image from URL:", dataItem.url);
      const imageResponse = await fetch(dataItem.url, { 
        timeout: 15000 // 15s timeout for image fetch
      });
      
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }
      
      const imageBuffer = await imageResponse.arrayBuffer();
      imageData = Buffer.from(imageBuffer).toString('base64');
    }

    const totalDuration = Date.now() - requestStart;
    console.log(`Total request time: ${totalDuration}ms`);

    res.json({ 
      image: imageData, 
      model: "gpt-image-1",
      processingTime: totalDuration,
      success: true
    });
    
  } catch (err) {
    const totalDuration = Date.now() - requestStart;
    console.error(`/api/generate-avatar error after ${totalDuration}ms:`, err.message);
    if (err) {
      console.error('OpenAI error details:', {
        status: err.status,
        code: err.code,
        type: err.type,
        message: err.message,
      });
      if (err.response) {
        console.error('OpenAI response status:', err.response.status);
        try {
          console.error('OpenAI response data:', JSON.stringify(err.response.data));
          if (err.response.data?.error?.message) {
            console.error('OpenAI error message:', err.response.data.error.message);
          }
        } catch {}
      }
    }

    // Enhanced error handling
    let status = 500;
    let errorCode = "UNKNOWN_ERROR";
    
    if (err.status) status = err.status;
    if (err.code === 'ENOTFOUND') {
      status = 503;
      errorCode = "NETWORK_ERROR";
    } else if (err.message?.includes('timeout')) {
      status = 408;
      errorCode = "TIMEOUT";
    } else if (err.message?.includes('rate limit')) {
      status = 429;
      errorCode = "RATE_LIMITED";
    }
    
    res.status(status).json({ 
      error: "Image transformation failed", 
      details: err.message,
      code: errorCode,
      processingTime: totalDuration
    });
  }
});

// Apply Core Style transformation
app.post("/api/apply-style", upload.single("image"), async (req, res) => {
  const requestStart = Date.now();
  console.log("=== APPLY STYLE REQUEST ===");
  console.log("File size:", req.file?.size, "bytes");
  console.log("Style:", req.body.style);
  console.log("Prompt:", req.body.prompt);
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No image uploaded",
        code: "MISSING_FILE"
      });
    }

    if (!req.body.prompt) {
      return res.status(400).json({ 
        error: "No style prompt provided",
        code: "MISSING_PROMPT"
      });
    }

    // Optimize image before sending to OpenAI (must be PNG for edits)
    let optimizedBuffer;
    try {
      optimizedBuffer = await sharp(req.file.buffer)
        .resize(1024, 1024, {
          fit: 'cover',
          position: 'center'
        })
        .png({
          quality: 90,
          compressionLevel: 6
        })
        .toBuffer();
      
      console.log(`Image optimized: ${req.file.size} -> ${optimizedBuffer.length} bytes`);
    } catch (sharpError) {
      console.error("Image optimization failed:", sharpError);
      optimizedBuffer = req.file.buffer; // Fallback to original
    }

    // Create file object using OpenAI helper
    const imageFile = await toFile(optimizedBuffer, 'current-frame.png', {
      type: 'image/png'
    });
    
    console.log("Sending style transform request to OpenAI...");
    const openAIStart = Date.now();
    
    // Use OpenAI image edit with gpt-image-1
    const editOptions = {
      model: "gpt-image-1", 
      image: imageFile,
      prompt: req.body.prompt,
      size: "1024x1024"
    };
    console.log('OpenAI edit options keys:', Object.keys(editOptions));
    console.log('Has response_format?', Object.prototype.hasOwnProperty.call(editOptions, 'response_format'));
    const response = await openai.images.edit(editOptions);

    const openAIDuration = Date.now() - openAIStart;
    console.log(`OpenAI response time: ${openAIDuration}ms`);

    const dataItem = response?.data?.[0];
    if (!dataItem?.b64_json && !dataItem?.url) {
      console.error("OpenAI returned unexpected payload", response);
      return res.status(502).json({ 
        error: "OpenAI did not return an image",
        code: "NO_IMAGE_RETURNED"
      });
    }

    // Handle response
    let imageData;
    if (dataItem.b64_json) {
      imageData = dataItem.b64_json;
    } else if (dataItem.url) {
      console.log("Fetching image from URL:", dataItem.url);
      const imageResponse = await fetch(dataItem.url, { 
        timeout: 15000
      });
      
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }
      
      const imageBuffer = await imageResponse.arrayBuffer();
      imageData = Buffer.from(imageBuffer).toString('base64');
    }

    const totalDuration = Date.now() - requestStart;
    console.log(`Total style transform time: ${totalDuration}ms`);

    res.json({ 
      image: imageData, 
      style: req.body.style,
      processingTime: totalDuration,
      success: true
    });
    
  } catch (err) {
    const totalDuration = Date.now() - requestStart;
    console.error(`/api/apply-style error after ${totalDuration}ms:`, err.message);
    if (err) {
      console.error('OpenAI error details:', {
        status: err.status,
        code: err.code,
        type: err.type,
        message: err.message,
      });
      if (err.response) {
        try {
          console.error('OpenAI error status:', err.response.status);
          console.error('OpenAI error data:', JSON.stringify(err.response.data));
          if (err.response.data?.error?.message) {
            console.error('OpenAI error message:', err.response.data.error.message);
          }
        } catch (e) {
          console.error('Failed to stringify OpenAI error response');
        }
      }
    }
    
    let status = 500;
    let errorCode = "UNKNOWN_ERROR";
    
    if (err.status) status = err.status;
    if (err.code === 'ENOTFOUND') {
      status = 503;
      errorCode = "NETWORK_ERROR";
    } else if (err.message?.includes('timeout')) {
      status = 408;
      errorCode = "TIMEOUT";
    } else if (err.message?.includes('rate limit')) {
      status = 429;
      errorCode = "RATE_LIMITED";
    }
    
    res.status(status).json({ 
      error: "Style transformation failed", 
      details: err.message,
      code: errorCode,
      processingTime: totalDuration
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum size is 15MB.',
        code: 'FILE_TOO_LARGE'
      });
    }
    return res.status(400).json({
      error: 'Upload error',
      code: error.code || 'UPLOAD_ERROR'
    });
  }
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// Static files with caching
app.use(express.static('.', {
  maxAge: '1h', // Cache static files for 1 hour
  etag: true
}));

// Whale verification API routes
if (whaleVerifyRoutes) {
    app.use('/api/whale-verify', whaleVerifyRoutes);
    console.log("✅ Whale verification routes registered at /api/whale-verify");
} else {
    console.error("❌ Whale verification routes NOT registered");
}

// Serve main HTML with no-cache for updates
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Backward compatible redirect for old dashboard URL
app.get('/dashboard.html', (req, res) => {
  res.redirect(302, '/dashboard/index.html');
});

// Whale members admin panel
app.get('/whale-members.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'whale-members.html'));
});

const PORT = Number(process.env.PORT || 3000);

// Enhanced server startup
if (process.env.NODE_ENV !== 'production') {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ CORE Server optimized and running at http://localhost:${PORT}`);
    console.log(`📈 Node environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🚀 Ready for requests`);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

module.exports = app;