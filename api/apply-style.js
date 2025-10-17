// Vercel serverless function for /api/apply-style
const OpenAI = require('openai');
const sharp = require('sharp');
const multer = require('multer');
const { toFile } = require('openai');

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

    if (!req.body.prompt) {
      return res.status(400).json({ 
        error: "No style prompt provided",
        code: "MISSING_PROMPT"
      });
    }

    // Optimize image
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
    } catch (sharpError) {
      console.error("Image optimization failed:", sharpError);
      optimizedBuffer = req.file.buffer;
    }

    const imageFile = await toFile(optimizedBuffer, 'current-frame.png', {
      type: 'image/png'
    });
    
    const openAIStart = Date.now();
    
    const editOptions = {
      model: "gpt-image-1", 
      image: imageFile,
      prompt: req.body.prompt,
      size: "1024x1024"
    };
    
    const response = await openai.images.edit(editOptions);

    const openAIDuration = Date.now() - openAIStart;

    const dataItem = response?.data?.[0];
    if (!dataItem?.b64_json && !dataItem?.url) {
      return res.status(502).json({ 
        error: "OpenAI did not return an image",
        code: "NO_IMAGE_RETURNED"
      });
    }

    let imageData;
    if (dataItem.b64_json) {
      imageData = dataItem.b64_json;
    } else if (dataItem.url) {
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

    res.json({ 
      image: imageData, 
      style: req.body.style,
      processingTime: totalDuration,
      success: true
    });
    
  } catch (err) {
    const totalDuration = Date.now() - requestStart;
    
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
};
