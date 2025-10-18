// Vercel serverless function for /api/generate-avatar
const OpenAI = require('openai');
const sharp = require('sharp');
const multer = require('multer');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Handle multipart form data with multer
  const runMiddleware = (middleware) => {
    return new Promise((resolve, reject) => {
      middleware(req, res, (result) => {
        if (result instanceof Error) {
          return reject(result);
        }
        return resolve(result);
      });
    });
  };

  try {
    await runMiddleware(upload.single('image'));
  } catch (error) {
    return res.status(400).json({ error: 'Failed to parse multipart data' });
  }

  const requestStart = Date.now();
  
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
};
